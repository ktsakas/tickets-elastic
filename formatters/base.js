"use strict";

var config = require("../config/config"),
	l = config.logger,
	fs = require('fs'),
	tracked = JSON.parse(fs.readFileSync('config/tracked.json', 'utf8')),
	// testObj = JSON.parse(fs.readFileSync('trash/test-obj.json', 'utf8')),
	RallyAPI = require('../rally/api'),
	FormatUtils = require('./utils');

const assert = require('assert');

/**
 * All formatting operations common between the objects fetched from
 * the Webhook API and objects recieved from webhooks are in this class.
 *
 * This is extened by SnapshotFormatter and WebhookFormatter classes.
 */
class FormatBase {
	/**
	 * Construct a new formatter either for a snapshot returned
	 * from the Lookback API or from a webhook.
	 * 
	 * @param  {object} obj
	 */
	constructor (obj) {
		assert(obj);

		this.obj = obj;
	}

	hasTrackedFields() {
		var fields = Object.keys(this.obj);
		for (var i= 0; i < tracked.length; i++) {
			if ( fields.indexOf(tracked[i]) != -1 ) return true;
		}

		return false;
	}

	format (mode) {
		assert(mode, "Missing mode argument.");

		this.obj = FormatUtils.format(this.obj, mode);

		this.addDummyData()
			.addStatus();

		var proms = [];
		proms.push( this.addProjectHierarchy() );
		proms.push( this.addTagNames() );
		proms.push( this.addDiscussionCount() );		

		return Promise.all(proms).then(() => this.obj);
	}

	/**
	 * Finds a project's ancestors and returns an array with their names.
	 * 
	 * @return {promise}
	 */
	addProjectHierarchy (projectUUID) {
		var self = this;
		projectUUID = projectUUID || this.obj.Project.UUID;

		return RallyAPI
			.getProject(projectUUID)
			.then((project) => {
				if (!this.obj.ProjectHierarchy) this.obj.ProjectHierarchy = [];
				self.obj.ProjectHierarchy.push(project._refObjectName);

				if (project.Parent) {
					return self.addProjectHierarchy(project.Parent._refObjectUUID);
				}
			});
	}

	/**
	 * Adds the tags to a revision.
	 * 
	 * @return {promise}
	 */
	addTagNames () {
		return RallyAPI
			.getTags(this.obj.Story.ID)
			.then((tags) => {
				this.obj.Tags = tags;
			});
	}

	addDiscussionCount () {
		var self = this;

		return RallyAPI
			.getDiscussions(self.obj.Story.ID)
			.then((discussions) => {
				var totalPosts = 0,
					exitDate = new Date(this.obj.Exited);

				discussions.forEach((discussion) => {
					var postDate = new Date(discussion.CreationDate);

					if (postDate.getTime() <= exitDate.getTime()) totalPosts++;
				});
				
				self.obj.TotalPosts = totalPosts;
			});
	}

	/**
	 * Computes the status for a given user story.
	 * The status is a field that does not exist in Rally or Salesforce,
	 * but is computed as a combination of the Project that a user story belongs
	 * to and the L3 Kanban Stage of the the user story.
	 * 
	 * @return {object}
	 */
	addStatus () {
		assert(this.obj.Project);

		if (
			this.obj.Project.Name.indexOf("L3") != -1 &&
			this.obj.L3KanbanStage != "To Be Scheduled" &&
			this.obj.L3KanbanStage != "Icebox" &&
			this.obj.L3KanbanStage != "Verified" &&
			this.obj.L3KanbanStage != "Closed") {
			this.obj.Status = "Res L3";
		} else if (
			(this.obj.Project.Name.indexOf("L3") == -1 &&
			this.obj.L3KanbanStage != "Verified" &&
			this.obj.L3KanbanStage != "Closed") ||
			
			(this.obj.Project.Name.indexOf("L3") != -1 &&
			(this.obj.L3KanbanStage == "To Be Scheduled" ||
			this.obj.L3KanbanStage == "Icebox"))
		) {
			this.obj.Status = "Product";
		} else if (
			this.obj.L3KanbanStage == "Verified" ||
			this.obj.L3KanbanStage == "Closed"
		) {
			this.obj.Status = "Resolved";
		} else {
			this.obj.Status = null;
		}

		return this;
	}

	/**
	 * Extends the Elastic document with dummy data for fields that
	 * have not yet been imported from Salesforce into ElasticSearch.
	 *
	 * NOTE: this will be removed in the future
	 * 
	 * @return {object}
	 */
	addDummyData () {
		var randCustomers = [
			'Adams Mark', 'Advena Hotels', 'Affinia Hotels', 'Avari Hotels', 'Champneys', 'Choice Hotels', 'Clarion Hotels', 'Club Med', 'Club Quarters', 'Coast Hotels', 'Conrad Hotels',
			'Crowne Plaza', 'Doubletree', 'Heartland Inn', 'Holiday Inn', 'Hotel Indigo', 'Hyatt Place', 'Microtel', 'Morgans Hotel Group', 'La Copa Inns', 'Hotel Ibis'
		];
		var randCustomerGroups = ['Penn', 'Hilton', 'Serai', 'Gondola', 'Transick', 'Beddom'];
		var randRegion = ['North America', 'South America', 'Europe', 'Asia', 'Australia'];

		// Use th Story ID to get consistent data across revisions on the same story
		this.obj.Customer = randCustomers[this.obj.Story.ID % randCustomers.length];
		this.obj.CustomerGroup = randCustomerGroups[this.obj.Story.ID % randCustomerGroups.length];
		this.obj.Region = randRegion[this.obj.Story.ID % randRegion.length];

		return this;
	}

	// This is overriden by child classes
	parseDates () {
		/*var Entered = this.obj.Entered,
			Exited = this.obj.Exited;

		if ( this.obj.Exited == null ) {
			this.obj.DurationDays = null;
		} else {
			var durationMs =
				new Date(this.obj.Exited).getTime() - new Date(this.obj.Entered).getTime();

			this.obj.DurationDays = durationMs / 1000 / 60 / 60 / 24;
		}*/

		return this;
	}
}

/*var testObj = FormatUtils.flatten(testObj);
// l.debug( "flattened obj: ", formatter.obj );

testObj = FormatUtils.renameFields(testObj, 'api');
// l.debug( "renamed fields: ", formatter.obj );

testObj = FormatUtils.removeUnused(testObj);
// l.debug( "removed unused: ", formatter.obj );


testObj = FormatUtils.unflatten(testObj);*/
// l.debug( "unflattened obj: ", testObj );
// l.debug( "keys: ", Object.keys(formatter.obj) );

module.exports = FormatBase;