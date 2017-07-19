// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

self.global = self.window = self;
importScripts('./foam.bundle.js');

require('../lib/client/release_interface_dao.es6.js');
require('../lib/confluence/api_velocity_data.es6.js');
require('../lib/confluence/browser_metric_data.es6.js');
require('../lib/dao_container.es6.js');
require('../lib/web_apis/release.es6.js');
require('../lib/web_apis/release_interface_relationship.es6.js');
require('../lib/web_apis/web_interface.es6.js');


foam.CLASS({
  refines: 'foam.messageport.MessagePortService',

  documentation: `Store a BroadcastBox to all connected pages.`,

  requires: [ 'foam.box.BroadcastBox' ],

  properties: [
    {
      name: 'broadcastBox',
      factory: function() { return this.BroadcastBox.create(); }
    },
  ],

  listeners: [
    function onMessage(port, e) {
      // Identical to foam.messageport.MessagePortService.onMesssage(), except
      // for this.broadcastBox management.
      var msg = this.fonParser.parseString(e.data);

      if ( this.RegisterSelfMessage.isInstance(msg.object) ) {
        var named = this.NamedBox.create({ name: msg.object.name });
        named.delegate = this.RawMessagePortBox.create({
          port: port
        });
        // TODO(markdittmer): Need a means of dropping disconnected pages in
        // ServiceWorker case.
        //
        // Assign property to trigger property change event.
        this.broadcastBox.delegates =
            this.broadcastBox.delegates.concat([named]);
        return;
      }

      this.delegate && this.delegate.send(msg);
    }
  ]
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'NewDataBroadcastBox',
  extends: 'foam.box.BroadcastBox',

  documentation: `A custom BroadcastBox bound to a
      MessagePortService.broadcastBox. This box is used to signal all connected
      pages that there are new data available.`,

  requires: [
    'foam.box.NamedBox',
    'org.chromium.apis.web.DAOContainer'
  ],

  properties: [
    {
      class: 'FObjectProperty',
      name: 'messagePortService',
      required: true,
      final: true
    }
  ],

  methods: [
    function init() {
      // Subscribe to property change events on message port broadcast box
      // delegates. This triggers rebinding to NamedBox multitons over the
      // "new data" service name.
      this.messagePortService.broadcastBox.delegates$
          .sub(this.onDelegatesChanged);
    }
  ],

  listeners: [
    function onDelegatesChanged(sub, _, __, slot) {
      // Rebind delegates to new page's "new data" service.
      const namedBoxes = slot.get();
      let delegates = new Array(namedBoxes.length);
      for (var i = 0; i < namedBoxes.length; i++) {
        const name =
            `${namedBoxes[i].name}/${this.DAOContainer.NEW_DATA_SERVICE_NAME}`;
        delegates[i] = this.NamedBox.create({
          name: name
        });
      }

      this.delegates = delegates;
    }
  ]
});

const pkg = org.chromium.apis.web;
const ctx = foam.box.Context.create({
  myname: pkg.DAOContainer.WORKER_BOX_CONTEXT_NAME
});
const newDataBox = pkg.NewDataBroadcastBox.create({
  messagePortService: ctx.messagePortService
}, ctx);

self.onmessage = function(event) {
  if (!event.data instanceof MessagePort) {
    throw new Error('Worker: Unexpected control message', event.data);
  }

  ctx.messagePortService.addPort(event.data);
};

function run() {
  const C = org.chromium.apis.web.DAOContainer;
  const E = foam.mlang.ExpressionsSingleton.create();
  function getDAOs(name, cls, opt_localDAO) {
    const local = opt_localDAO || foam.dao.IDBDAO.create({
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
                    console.log('New release available:', release.releaseKey);
                    loadedReleases.put(release);
                    newDataBox.send(foam.box.Message.create({
                      object: release.releaseKey
                    }));
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
