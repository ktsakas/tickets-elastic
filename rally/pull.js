"use strict";

var Multiprogress = require("multi-progress");
var multi = new Multiprogress(process.stderr);

var assert = require('assert'),
	config = require('../config/config'),
	l = config.logger,
	Promise = require('bluebird'),
	ESObject = require('../models/elastic-orm'),
	Revisions = require('../models/revisions'),
	async = require('async');

var RallyAPI = require("./api"),
	FormatUtils = require("../formatters/utils"),
	SnapshotsFormatter = require('../formatters/snapshots');


const PAGESIZE = 200;

var totalArtifacts = null,
	artifacts = [],
	fetchProgress,
	historyProgress;

class RallyPull {
	/**
	 * Pulls in the details for all artifacts (no history/revisoins).
	 *
	 * Iterates 200 artifacts at a time until all objects for all artifacts have
	 * been fetched.
	 * 
	 * @param  {integer} start
	 * @param  {integer} pagesize
	 * @return {promise}
	 */
	static pullRevisions(artifactID, workspaceID) {
		return RallyAPI
			.getArtifactRevisions(artifactID, workspaceID, 0)
			.then((res) => {
				assert(res.Results);

				// Two dimentional array that holds all revisions
				var proms = [];

				// If there are more revisions for this story pull them all
				for (var start = 100; start < res.TotalResultCount; start += 100) {
					proms.push(
						RallyAPI
							.getArtifactRevisions(artifactID, workspaceID, start)
							.then((extraRes) => {
								res.Results = res.Results.concat(extraRes.Results);
							})
					);
				}

				return Promise.all(proms).then(() => res.Results);
			});
	}

	/**
	 * Formats and stores the revisions pulled by calling pullRevisions into ElasticSearch.
	 * 
	 * @param  {object}  artifact
	 * @param  {integer} workspaceID
	 * @return {promise}
	 */
	static pullHistory (artifact, workspaceID) {
		return RallyPull
			.pullRevisions(artifact.Story.ID, workspaceID)
			.then((results) => {
				if (results.length == 0) {
					// l.warn("No revisions in story: " + artifact.ObjectID);
					return;
				}

				return new SnapshotsFormatter(results)
					.append(artifact)
					.getRevisions()
					.then((snapshots) => {
						return new Revisions(snapshots).create();
					});
			})
			// Update the progress bar
			.then(historyProgress.tick);
	}

	/**
	 * Pulls in the details for all artifacts (no history/revisoins).
	 *
	 * Iterates 200 artifacts at a time until all objects for all artifacts have
	 * been fetched.
	 * 
	 * @param  {integer} start
	 * @param  {integer} pagesize
	 * @return {promise}
	 */
	static pullArtifacts (start, pagesize) {
		assert(pagesize <= 200);

		return RallyAPI
			.getArtifacts(start, 200)
			.then((response) => {
				assert(response.Results);

				var end = Math.min(start + PAGESIZE, totalArtifacts);

				fetchProgress.tick(PAGESIZE);

				return response.Results.map((result) => FormatUtils.format(result, 'api'));
			}).then((artifacts) => {
				return Promise.all(artifacts.map((artifact) => {
					return RallyPull.pullHistory(artifact, config.rally.workspaceID);
				}));
			});
	}

	/**
	 * Use this function to pull in all data for user stories to ElasticSearch.
	 */
	static pullAll () {
		l.info("Indexing Rally data into /" + config.elastic.index + "/" + config.elastic.type + " ...");

		Promise
			.resolve([
				RallyAPI.countArtifacts(),
				Revisions.createMapping()
			])
			.spread((numOfArtifacts) => {
				totalArtifacts = numOfArtifacts;

				l.info("Total number of artifacts: " + totalArtifacts);

				fetchProgress = multi.newBar('Pulling artifacts [:bar] :percent', {
					complete: '=',
					incomplete: ' ',
					width: 40,
					total: 100000
				});

				/*fetchProgress.on('end', function () {
					console.log('\n');
				});*/

				historyProgress = multi.newBar('Pulling history [:bar] :percent', {
					complete: '=',
					incomplete: ' ',
					width: 40,
					total: 100000
				});

				fetchProgress.total = totalArtifacts;
				historyProgress.total = totalArtifacts;

				var starts = [];
				for (var start = 1; start < totalArtifacts; start += PAGESIZE) {
					starts.push(start);
				}

				Promise.reduce(starts, function (total, start) {
					return RallyPull.pullArtifacts(start, PAGESIZE);						
				}).then(() => {
					l.debug("done!");
				});
			});
	}
}

// Pull all the data
RallyPull.pullAll();

module.exports = RallyPull;