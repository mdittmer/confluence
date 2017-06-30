// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('angular');

require('../dao/contextualizing_dao.es6.js');
require('../dao/lazy_cache_dao.es6.js');
require('../web_apis/release.es6.js');
require('../web_apis/release_interface_relationship.es6.js');
require('../web_apis/web_interface.es6.js');
require('./api_confluence.es6.js');
require('./api_matrix.es6.js');

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

  const boxCtx = foam.box.Context.create();
  const ctx = foam.__context__.createSubContext(boxCtx).createSubContext({
    registry:
    // foam.box.ClientBoxRegistry.create({
    //   delegate: foam.box.LogBox.create({
    //     name: 'registry',
    //     delegate:
        boxCtx.registry,
    //   }, boxCtx),
    // }, boxCtx),
  });
  // Names must match those registered in in server box context.
  function getDAO(name, cls, opt_noDisjunction) {
    var networkDAO = foam.dao.LoggingDAO.create({
      name: name,
      delegate: foam.dao.StreamingClientDAO.create({
        of: cls,
        delegate: foam.box.SubBox.create({
          name: name,
          delegate: foam.box.WebSocketBox.create({
            // TODO(markdittmer): Explicitly select webSocketService port.
            // (Current default: 4000.)
            uri: 'ws://0.0.0.0:4000',
          }, ctx),
        }, ctx),
      }, ctx),
    }, ctx);
    if (opt_noDisjunction) {
      networkDAO = foam.dao.NoDisjunctionDAO.create({
        of: cls,
        delegate: networkDAO,
      }, ctx);
    }
    return org.chromium.apis.web.LazyCacheDAO.create({
      cache: foam.dao.IDBDAO.create({
        name: name,
        of: cls,
      }, ctx),
      delegate: networkDAO,
    }, ctx);
  }

  const Release = org.chromium.apis.web.Release;
  const WebInterface = org.chromium.apis.web.WebInterface;
  const ReleaseWebInterfaceJunction =
      org.chromium.apis.web.ReleaseWebInterfaceJunction;
  const ApiVelocityData = foam.lookup('org.chromium.apis.web.ApiVelocityData');
  const BrowserMetricData =
      foam.lookup('org.chromium.apis.web.BrowserMetricData');

  const releaseDAO = getDAO('releaseDAO', Release);

  // No disjunction on webInterfaceDAO. This will split joins such as:
  //     releaseWebInterfaceJunctionDAO.where(ReleaseId=<some release>)
  //     ==> webInterfaceDAO.where(ApiId IN [... long list ...])
  // into:
  //     <same>
  //     ==> [webInterfaceDAO.find(ApiId=<long list element 1>), ...]
  //
  // The large query in the former joins produces oversized WebSocket messages.
  const webInterfaceDAO = getDAO('webInterfaceDAO', WebInterface, true);

  const releaseWebInterfaceJunctionDAO = getDAO(
      'releaseWebInterfaceJunctionDAO', ReleaseWebInterfaceJunction);
  const apiVelocityDAO = getDAO('apiVelocityDAO', ApiVelocityData);
  const failureToShipDAO = getDAO('failureToShipDAO', BrowserMetricData);
  const browserSpecificDAO = getDAO('browserSpecificDAO', BrowserMetricData);
  const aggressiveRemovalDAO =
      getDAO('aggressiveRemovalDAO', BrowserMetricData);

  const daoCtx = ctx.createSubContext({
    releaseDAO,
    webInterfaceDAO,
    releaseWebInterfaceJunctionDAO,
    apiVelocityDAO,
    failureToShipDAO,
    browserSpecificDAO,
  });

  function contextualizeDAO(dao) {
    return org.chromium.apis.web.ContextualizingDAO.create({
      delegate: dao,
    }, daoCtx);
  }

  return ctx.createSubContext({
    releaseDAO: contextualizeDAO(releaseDAO),
    webInterfaceDAO: contextualizeDAO(webInterfaceDAO),
    releaseWebInterfaceJunctionDAO: contextualizeDAO(
        releaseWebInterfaceJunctionDAO),
    apiVelocityDAO: contextualizeDAO(apiVelocityDAO),
    failureToShipDAO: contextualizeDAO(failureToShipDAO),
    browserSpecificDAO: contextualizeDAO(browserSpecificDAO),
  });
}]);
