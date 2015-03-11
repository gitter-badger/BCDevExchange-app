/*
 Copyright 2015 Province of British Columbia

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and limitations under the License.
 */
var async = require('async');
var request = require('request');

// simple route middleware to ensure user is authenticated
// use this route middleware on any resource that needs to be protected
// if the request is authenticated the request will proceed
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.sendStatus(401);
    }
}

function loginCallbackHandler(req, res, db, logger) {
    db.Profile.findById(req.user.profiles[0])
        .exec(function (err, profile){
            if (err) {
                logger.error(err);
                res.sendStatus(500);
            }

            if (profile) {
                res.cookie('user', JSON.stringify({
                    'displayName': profile.name.value
                }));
                res.redirect('/#/account?id=' + req.user.identities[0].identifier);
            }
        });
}

module.exports = function(app, config, logger, db, passport) {

    // ===== Low level conf for client side ======
    app.get("/config",
        function (req, res) {
            res.send(config.ui);
        }
    );

    // ===== authentication page routing ======

    // GET /auth/github
    // use passport.authenticate() as route middleware to authenticate the request
    app.get('/auth/github',
        passport.authenticate('github'),
        function(req, res) {
            //the request will be redirected to github for auth, so this function will not be called
        });

    // GET /auth/github/callback
    // use passport.authenticate() as route middleware to authenticate the request
    // if auth fails, the user will be redirected back to the login page
    // otherwise, the primary route function will be called which will redirect the user to the home page
    app.get('/auth/github/callback',
        passport.authenticate('github', {
            scope: ['user', 'repo'],
            failureRedirect: '/#/login'
        }),
        function(req, res) {
            loginCallbackHandler(req, res, db, logger);
        });

    // GET /auth/linkedin
    // use passport.authenticate() as route middleware to authenticate the request
    app.get('/auth/linkedin',
        passport.authenticate('linkedin'),
        function(req, res) {
            //the request will be redirected to linkedin for auth, so this function will not be called
        });

    // GET /auth/linkedin/callback
    // use passport.authenticate() as route middleware to authenticate the request
    // if auth fails, the user will be redirected back to the login page
    // otherwise, the primary route function will be called which will redirect the user to the home page
    app.get('/auth/linkedin/callback',
        passport.authenticate('linkedin', {
            failureRedirect: '/#/login'
        }),
        function(req, res) {
            loginCallbackHandler(req, res, db, logger);
        });

    // ===== logout routing ======

    app.post('/logout', function(req, res) {
        req.logOut();
        res.sendStatus(200);
    });

    // ===== account page routing ======

    app.get('/account/:id', ensureAuthenticated, function(req, res) {
        db.getAccount({'identities.identifier': req.params.id}, res);
    })

    app.post('/account/:id', ensureAuthenticated, function(req, res) {
        var acctData = req.body;

        db.Account.findById(acctData._id)
            .populate('profiles')
            .exec(function (err, account) {
                if (err) {
                    logger.error(err);
                }

                if (account) {
                    account.profiles[0].visible = acctData.profiles[0].visible;
                    account.profiles[0].contactPreferences.notifyMeOfAllUpdates = acctData.profiles[0].contactPreferences.notifyMeOfAllUpdates;
                    account.profiles[0].save(function (err) {
                        if (err) {
                            logger.error(err);
                        }

                        res.json(account);

                    });
                }
            });
    });

    app.get('/resources', function(req, res) {
        async.concat(config.catalogues, getCatalogueItems, function (err, results) {
            if (err) res.sendStatus(500);
            else {
                var body = {"resources": results};
                res.send(body);
            }
        });
    });

    // Just gets items from CKAN v3 compatible APIs
    function getCatalogueItems (catalogue, callback) {
        request(catalogue.baseUrl + '/action/package_search?q=tags:' + catalogue.tagToSearch, function (error, response, body) {
            if (!error &&
                typeof response !== 'undefined' &&
                response.statusCode == 200) {

                var json = JSON.parse(body);

                // remove extraneous info from result
                async.concat(json.result.results, transformCKANResult, function (err, results) {
                    copyCatalogue(catalogue, results);
                    callback(err, results);
                });
            }
            else if(error) {
                logger.error('Error while fetching BCDC content: %s; body: %s', error, body);
                callback(error);
            }
        });
    }

    function copyCatalogue (catalogue, results) {
        for (var i = 0; i < results.length; i++) {
            results[i].catalogue = {"name": catalogue.name,
                "acronym": catalogue.acronym};
        }
    }

    // Filter out data that doesn't appear on the site
    function transformCKANResult (result, callback) {
        var transformed = {
            "title": result.title,
            "notes": result.notes,
            "tags": result.tags,
            "record_last_modified": result.record_last_modified,
            "resources": result.resources
        };

        // trim the tags
        async.concat(result.tags, function(item, tagsCallback) {
           tagsCallback(null, {"display_name": item.display_name,
                "id": item.id})},
           function (error, results) {
                transformed.tags = results;
           });

        // trim the resources
        async.concat(result.resources, function(item, resourceCallback) {
            resourceCallback(null, {"name": item.name,
                "url": item.url})},
            function (error, results) {
                transformed.resources = results;
            });

        callback(null, transformed);
    }
}
