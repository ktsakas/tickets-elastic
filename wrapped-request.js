var config = require('./config/config'),
	l = config.logger,
	Promise = require('bluebird'),
	rp = require('request-promise'),
	// rp = require('request'),
	fs = Promise.promisifyAll(require('fs')),
	queryString = require('querystring'),
	sanitize = require("sanitize-filename"),
	crypto = require('crypto'),
	async = require('async');


var cache = false,
	requestQueue = async.queue((job, callback) => {
		job().then( callback.bind(callback, null) ).catch(callback);
	}, 100);

function WrappedRequest (req) {
	return WrappedRequest.rateLimitedRequest(req);
}

WrappedRequest.rateLimitedRequest = function (req) {
	var job = function () {
		if (cache && req.method == 'GET') {
			return WrappedRequest.cachedRequest(req);
		} else {
			return WrappedRequest.repeatOnErrorRequest(req);
		}
	};

	return Promise.promisify(requestQueue.push)(job);
}

WrappedRequest.repeatOnErrorRequest = function (req) {	
	return rp(req)

		// Try the request again on error
		.catch((err) => {
			return rp(req);
		})

		// If you fail twice exit the program
		.catch((err) => {
			if (err.message === 'Error: ETIMEDOUT') {
				l.error("Connection timedout twice. Exiting...");
				process.exit(1);
			} else {
				throw err;
			}
		});
};

var count = 0;
WrappedRequest.cachedRequest = function (req) {	
	// File path for cached response
	var queryURL = req.uri + "?" + queryString.unescape(queryString.stringify(req.qs)),
		fileName = crypto.createHash('md5').update(queryURL).digest('hex'),
		filePath = "./cached-responses/" + fileName,
		fd = null;

			// Try to find cached response
	return fs.readFileAsync(filePath, 'utf8')

			// Parse from string to json
			.then((cachedRes) => {
				cachedRes = JSON.parse(cachedRes);

				if (typeof cachedRes != "object") {
					throw Error("Non json response.");
				}

				return cachedRes;
			})

			// If you dont find the response in the cache
			.catch((err) => {
				return WrappedRequest
					.repeatOnErrorRequest(req)
					.then((res) => {
						if (typeof res != "object") {
							l.error("Response is not an object.");
							l.error(req, res);
							process.exit(1);
						}

						var resString = JSON.stringify(res);

						try {
							fs.writeFileSync(filePath, resString);
						} catch(e) {
							l.error("Failed to cache request.", err);
							process.exit(1);
						}
						
						return res;
					});
			});

			// We should never fail to parse the JSON
			/*.catch((err) => {
				l.error("Failed to parse JSON. Exiting...", err);
				process.exit(1);
			});*/
};

WrappedRequest.defaults = function (options) {
	if (options.cache) {
		cache = options.cache;
		delete options.cache;
	}

	rp = rp.defaults(options);
	return WrappedRequest;
};

module.exports = WrappedRequest;