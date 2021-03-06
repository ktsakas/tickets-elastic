"use strict";

var config = require("../config/config"),
	l = config.logger,
	ElasticOrm = require('./elastic-orm'),
	stateOrm = new ElasticOrm(
		config.esClient,
		config.elastic.index,
		config.elastic.type
	);

var fs = require('fs'),
	mappings = JSON.parse(fs.readFileSync('config/mappings.json', 'utf8')),
	tracked = JSON.parse(fs.readFileSync('config/tracked.json', 'utf8')),
	schema = JSON.parse(fs.readFileSync('config/schema.json', 'utf8'));

const assert = require('assert');

// Create a null valued object of all schema fields
var nulledValues = {};
for (var field in schema) {
	nulledValues[field] = null;
}

class Revision {
	constructor (stateObj, id) {
		if (id) this._id = id;

		this.model = stateObj;
	}

	/**
	 * Builds the mapping object for ElasticSearch.
	 * 
	 * @return {object}
	 */
	static createMapping() {
		var mapping = {};

		for (var fieldName in mappings) {
			mapping[fieldName] = {
				type: mappings[fieldName]
			};

			if (mappings[fieldName] == "string") {
				mapping[fieldName].index = "not_analyzed";
			}
		}

		return mapping;
	}

	/**
	 * Returns the most recent revision of a user story in Elastic.
	 * 
	 * @return {object}
	 */
	findLatestRevision() {
		return stateOrm.filter([
			{ term: { "Story.ID": this.model.Story.ID } },
			{ missing: { "field": "Exited" } }
		]).then((result) => {
			return (result.hits.total == 0) ? null :
					new Revision(result.hits.hits[0]._source, result.hits.hits[0]._id);
		});
	}

	/**
	 * Given a revision it checks if has any fields for which we are tracking changes.
	 * 
	 * @return {boolean}
	 */
	hasTrackedFields() {
		var fields = Object.keys(this.model);
		for (var i= 0; i < tracked.length; i++) {
			if ( fields.indexOf(tracked[i]) != -1 ) return true;
		}

		return false;
	}

	getObj() {
		return this.model;
	}

	setDates(exitedDate) {
		this.model.Exited = exitedDate;
		var durationMs = new Date(this.model.Exited).getTime() - new Date(this.model.Entered).getTime();

		this.model.DurationDays = durationMs / 1000 / 60 / 60 / 24;
		this.update();
	}

	/**
	 * Update an exising revision in elastic.
	 * 
	 * @return {promise}
	 */
	update() {
		assert(this._id);

		return stateOrm.update(this.model, this._id);
	}

	/**
	 * Create a new revision in elastic.
	 * 
	 * @return {promise}
	 */
	create() {
		return stateOrm.index(this.model, this._id);
	}

	/**
	 * Sets the time a revision exited it's moved to the next one
	 * and updated the duration that the revision was valid for.
	 * 
	 * @param {date} date the date to set exited to
	 */
	setExited(date) {
		this.obj.Exited = date;

		var durationMs =
			new Date(this.obj.Exited).getTime() - new Date(this.obj.Entered).getTime();
		this.obj.DurationDays = durationMs / 1000 / 60 / 60 / 24;

		return this.update();
	}

	/**
	 * Creates a new revision in the database if the revision has fields that we are tracking updates for
	 * otherwise it just updates the fields of the most recent revision to match the current state of the user story.
	 *
	 * NOTE: this is not used when pulling from the API, because ElasticSearch is near real time
	 **/
	save() {
		var self = this;

		return this
			.findLatestRevision()
			.then((latestRevision) => {
				// If this revision has tracked fields
				if (self.hasTrackedFields()) {
					// Create a new revision
					return stateOrm
						.index(self.model, self._id)
						.then((res) => {
							// l.debug("New revision saved successfully.");

							if (!latestRevision)
								return self.model;
							else
								return latestRevision.setExited(self.model.Entered).then(() => self.model);
						})
						.catch((err) => {
							l.error("Failed to insert new revision to elastic. ", err);
						});
					

				// Otherwise only update the fields
				} else if (latestRevision) {
					// Assert that the previous revision is valid
					assert(latestRevision.hasTrackedFields());

					// Do not change the state enter and exit times
					// only update the fields
					delete self.model.Entered;
					delete self.model.Exited;

					return latestRevision.update(self.model).then(() => self.model);
				} else {
					l.warn("Could not find previous revision for " + self.model.Story.ID + " when inserting from hook." +
						" An initial revision should usually be present.");

					return Promise.resolve(self.model);
				}
			});
	}
}

module.exports = Revision;