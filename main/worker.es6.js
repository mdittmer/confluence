// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

self.global = self.window = self;
importScripts('./foam.bundle.js');

require('../lib/confluence/api_velocity_data.es6.js');
require('../lib/confluence/browser_metric_data.es6.js');
require('../lib/confluence/release_interface_dao.es6.js');
require('../lib/dao_container.es6.js');
require('../lib/web_apis/release.es6.js');
require('../lib/web_apis/release_interface_relationship.es6.js');
require('../lib/web_apis/web_interface.es6.js');

function run() {
  const ctx = foam.box.Context.create();
  const C = org.chromium.apis.web.DAOContainer;
  const E = foam.mlang.ExpressionsSingleton.create();
  function getDAOs(name, cls, opt_localDAO) {
    const local = opt_dao || foam.dao.IDBDAO.create({
      name: name,
      of: cls,
    }, ctx);
    const remote = foam.dao.StreamingClientDAO.create({
      of: cls,
      delegate: foam.box.SubBox.create({
        name: name,
        delegate: foam.box.WebSocketBox.create({
          // TODO(markdittmer): Explicitly select webSocketService port.
          // (Current default: 4000.)
          uri: 'ws://0.0.0.0:4000',
        }, ctx),
      }, ctx),
    }, ctx);

    return {local, remote};
  }
  function loadDAO(o) {
    return o.remote.select(foam.dao.DAOSink.create({
      dao: o.local
    }, ctx));
  }

  const pkg = org.chromium.apis.web;
  const releaseDAOs = getDAOs(C.RELEASE_NAME, pkg.Release);
  const webInterfaceDAOs = getDAOs(C.WEB_INTERFACE_NAME, pkg.WebInterface);
  const apiVelocityDAOs = getDAOs(C.API_VELOCITY_NAME, pkg.ApiVelocityData);
  const failureToShipDAOs =
      getDAOs(C.FAILURE_TO_SHIP_NAME, pkg.BrowserMetricData);
  const browserSpecificDAOs =
      getDAOs(C.BROWSER_SPECIFIC_NAME, pkg.BrowserMetricData);
  const aggressiveRemovalDAOs =
      getDAOs(C.AGGRESSIVE_REMOVAL_NAME, pkg.BrowserMetricData);

  // Fully load all relatively small data (except Release, see below).
  loadDAO(webInterfaceDAOs);
  loadDAO(apiVelocityDAOs);
  loadDAO(browserSpecificDAOs);
  loadDAO(aggressiveRemovalDAOs);

  // Prepare DAOs for expensive junction data.
  const releaseWebInterfaceJunctionDAOs = getDAOs(
      C.RELEASE_WEB_INTERFACE_JUNCTION_NAME,
      pkg.ReleaseWebInterfaceJunction,
      pkg.ReleaseWebInterfaceJunctionDAO.create(null, ctx));

  // Load Releases, then load unloaded release-API junctions.
  loadDAO(releaseDAOs).then(daoSink => {
    const releases = releaseDAOs.local;
    const junctions = releaseWebInterfaceJunctionDAOs;

    // Track loaded releases in IDB.
    // Iterate over all releases (newest releases first), and load each unloaded
    // release.
    //
    // TODO(markdittmer): Provide mechanism for invalidating these data in case
    // data model changes.
    const loadedReleases = foam.dao.IDBDAO.create({
      name: 'loadedReleasesDAO',
      of: pkg.Release
    }, ctx);
    releases.orderBy(E.DESC(pkg.Release.RELEASE_DATE)).select(
        foam.dao.QuickSink.create({
          putFn: release => {
            loadedReleases.find(release.id).then(loadedRelease => {
              if (loadedRelease !== null) return;
              junctions.remote.where(
                  E.EQ(pkg.ReleaseWebInterfaceJunction.SOURCE_ID, release.id))
                  .select(foam.dao.DAOSink.create({dao: junctions.local}))
                  .then(() => {
                    // TODO(markdittmer): Signal page(s) that new data are
                    // available.
                    loadedReleases.put(release);
                  });
            });
          }
        }, ctx));
  });
}

if (self.DedicatedWorkerGlobalScope &&
    self instanceof self.DedicatedWorkerGlobalScope) {
  run();
} else if (self.ServiceWorkerGlobalScope &&
    self instanceof self.ServiceWorkerGlobalScope) {
  self.addEventListener('activate', run);
} else {
  console.error('Unknown worker type', self);
}
