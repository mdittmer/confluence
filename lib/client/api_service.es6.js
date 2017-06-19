// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('angular');

require('./api_confluence.es6.js');
require('./api_matrix.es6.js');
require('../web_apis/release.es6.js');
require('../web_apis/release_interface_relationship.es6.js');
require('../web_apis/web_interface.es6.js');

// TODO(markdittmer): Use foam.lookup() for class lookup. May also need to shove
// this into a FOAM class when porting to FOAM classloader.
angular.module('confluence').service('api', ['$window', function($window) {
  const ORIGIN = $window.location.origin;
  const RELEASE_API_URL = ORIGIN + '/release-apis';
  const RELEASE_URL = ORIGIN + '/releases';
  const WEB_INTERFACE_URL = ORIGIN + '/web-interfaces';
  const API_VELOCITY_URL = ORIGIN + '/api-velocity';
  const FAILURE_TO_SHIP_URL = ORIGIN + '/failure-to-ship';
  const BROWSER_SPECIFIC_URL = ORIGIN + '/browser-specific';
  const AGGRESSIVE_REMOVAL_URL = ORIGIN + '/aggressive-removal';

  function dao(name, of, restURL) {
    // DAO flow:
    // --> MDAO -- cache miss --> IDBDAO -- cache miss --> RestDAO
    // <--/    \-- cache result --/    |                    |
    // <-------------------------/     |                    |
    //                                  \-- cache result --/
    // <--------------------------------------------------/
    return foam.dao.LazyCacheDAO.create({
      cacheOnSelect: true,
      staleTimeout: Infinity,
      cache: foam.dao.CachingDAO.create({
        cache: foam.dao.MDAO.create({of: of}),
        src: foam.dao.IDBDAO.create({name: name, of: of}),
      }),
      delegate: foam.dao.RestDAO.create({
        baseURL: restURL,
        of: of,
      }),
    });
  }

  let releaseDAO = dao(
      'releaseDAO', org.chromium.apis.web.Release, RELEASE_URL);
  let webInterfaceDAO = dao(
      'webInterfaceDAO', org.chromium.apis.web.WebInterface, WEB_INTERFACE_URL);
  let releaseWebInterfaceJunctionDAO = dao(
      'releaseWebInterfaceJunctionDAO',
      org.chromium.apis.web.ReleaseWebInterfaceJunction,
      RELEASE_API_URL);
  let apiVelocityDAO = dao('apiVelocityDAO',
                           org.chromium.apis.web.ApiVelocityData,
                           API_VELOCITY_URL);
  let failureToShipDAO = dao('failureToShipDAO',
                             org.chromium.apis.web.BrowserMetricData,
                             FAILURE_TO_SHIP_URL);
  let browserSpecificDAO = dao('browserSpecificDAO',
                               org.chromium.apis.web.BrowserMetricData,
                               BROWSER_SPECIFIC_URL);
  let aggressiveRemovalDAO = dao('aggressiveRemovalDAO',
                                 org.chromium.apis.web.BrowserMetricData,
                                 AGGRESSIVE_REMOVAL_URL);

  // Provide a context that is aware to relationship DAOs.
  // TODO(markdittmer): providing an interface for binding
  // DAOs on Relationships.
  var ctx = foam.__context__.createSubContext({
    releaseDAO,
    webInterfaceDAO,
    releaseWebInterfaceJunctionDAO,
    apiVelocityDAO,
    failureToShipDAO,
    browserSpecificDAO,
    aggressiveRemovalDAO,
  });

  let apiMatrix = org.chromium.apis.web.ApiMatrix.create(null, ctx);
  let apiConfluence = org.chromium.apis.web.ApiConfluence.create(null, ctx);

  return {
    matrix: apiMatrix,
    confluence: apiConfluence,
    promises: [],
  };
}]);
