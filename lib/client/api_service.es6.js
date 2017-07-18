// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('angular');

require('../confluence/browser_metric_data.es6.js');
require('../dao_container.es6.js');
require('../web_apis/release.es6.js');
require('../web_apis/release_interface_relationship.es6.js');
require('../web_apis/web_interface.es6.js');
require('./api_confluence.es6.js');
require('./api_matrix.es6.js');
require('./release_interface_dao.es6.js');

// TODO(markdittmer): Use foam.lookup() for class lookup. May also need to shove
// this into a FOAM class when porting to FOAM classloader.
angular.module('confluence').service('api', ['$window', function($window) {
  const ORIGIN = $window.location.origin;

  const ctx = foam.box.Context.create();
  const C = org.chromium.apis.web.DAOContainer;
  // Names must match those registered in in server box context.
  function getDAO(name, cls) {
    return foam.dao.IDBDAO.create({
      name: name,
      of: cls,
    }, ctx);
  }

  const Release = org.chromium.apis.web.Release;
  const WebInterface = org.chromium.apis.web.WebInterface;
  const ReleaseWebInterfaceJunction =
      org.chromium.apis.web.ReleaseWebInterfaceJunction;
  const ReleaseWebInterfaceJunctionDAO =
      org.chromium.apis.web.ReleaseWebInterfaceJunctionDAO;

  let releaseDAO = getDAO(C.RELEASE_NAME, Release);
  let webInterfaceDAO = getDAO(C.WEB_INTERFACE_NAME, WebInterface);
  let releaseWebInterfaceJunctionDAO = ReleaseWebInterfaceJunctionDAO
      .create(null, ctx);
  let promises = [
    releaseDAO.select(),
    webInterfaceDAO.select(),
  ];
  let apiMatrix = org.chromium.apis.web.ApiMatrix.create({
    releaseWebInterfaceJunctionDAO,
    releaseDAO,
    webInterfaceDAO,
  },
  // Provide a context that is aware to relationship DAOs.
  // TODO(markdittmer): providing an interface for binding
  // DAOs on Relationships.
  foam.__context__.createSubContext({
    releaseDAO,
    webInterfaceDAO,
    releaseWebInterfaceJunctionDAO,
  }));

  const ApiVelocityData = org.chromium.apis.web.ApiVelocityData;
  const BrowserMetricData = org.chromium.apis.web.BrowserMetricData;
  let apiVelocityDAO =
      getDAO(C.API_VELOCITY_NAME, ApiVelocityData);
  let failureToShipDAO =
      getDAO(C.FAILURE_TO_SHIP_NAME, BrowserMetricData);
  let browserSpecificDAO =
      getDAO(C.BROWSER_SPECIFIC_NAME, BrowserMetricData);
  let aggressiveRemovalDAO =
      getDAO(C.AGGRESSIVE_REMOVAL_NAME, BrowserMetricData);
  let apiConfluence = org.chromium.apis.web.ApiConfluence.create({
    apiVelocityDAO,
    failureToShipDAO,
    browserSpecificDAO,
    aggressiveRemovalDAO,
  });

  return {
    matrix: apiMatrix,
    confluence: apiConfluence,
    promises,
  };
}]);
