// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('../dao_container.es6.js');

//
// Register a box that supports subscriptions under a known name.
//
foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'PubBox',
  implements: [ 'foam.box.Box' ],

  methods: [ function send(message) { this.pub('message', message); } ],
});
const pkg = org.chromium.apis.web;
const ctx = foam.box.Context.create();
const pubBox = pkg.PubBox.create({ name: 'New data' }, ctx);
ctx.registry.register(pkg.DAOContainer.NEW_DATA_SERVICE_NAME, null, pubBox);

//
// Setup a worker that can send signals itself to "pubBox".
//
let workerBox;
function runDedicatedWorker() {
  if (worker) return;
  workerBox = foam.box.MessagePortBox.create({
    target: new Worker('worker.bundle.js')
  }, ctx);
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    try {
      navigator.serviceWorker.register('worker.bundle.js')
          .then(registration => {
            console.log('ServiceWorker registration successful with scope:',
                        registration.scope);
            return navigator.serviceWorker.ready;
          }).then(registration => {
            workerBox = foam.box.MessagePortBox.create({
              target: registration.active
            }, ctx);
            foam.box.NamedBox.create({
              name: pkg.DAOContainer.WORKER_BOX_CONTEXT_NAME,
              delegate: workerBox
            }, ctx).send(foam.box.Message.create({
              object: foam.box.HelloMessage.create()
            }));
          }).catch(error => {
            console.warn('ServiceWorker registration failed:', error);
            runDedicatedWorker();
          });
    } catch (error) {
      console.warn('ServiceWorker registration failed:', error);
      runDedicatedWorker();
    }
  });
} else {
  runDedicatedWorker();
}
// TODO(markdittmer): This is not causing worker's ports to be invalidated.
// Need something else for this.
window.addEventListener('unload', function() {
  workerBox &&  workerBox.delegate && workerBox.delegate.port &&
    workerBox.delegate.port.close();
});

module.exports = pubBox;
