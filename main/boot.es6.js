// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

//
// App code run before loading FOAM or application dependencies.
//

const worker = new Worker('worker.bundle.js');
let serviceWorker; // Set when service worker is ready.
let workerName;    // Set when FOAM is loaded.
let ctx;           // Set when FOAM is loaded.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('service_worker.bundle.js');
    navigator.serviceWorker.ready.then(registration => {
      serviceWorker = registration.active;
      if (ctx) onFOAMAndServiceWorker();
    });
  });
}

// When service worker and FOAM are both loaded, provide dedicated worker and
// service worker with a direct channel to each other.
let pkg;
function onFOAMAndServiceWorker() {
  if (!ctx) return;
  const serviceWorkerName =
      require('../lib/names.es6.js').SERVICE_WORKER_BOX_CONTEXT_NAME;
  foam.box.NamedBox.create({
    name: serviceWorkerName,
    delegate: foam.box.MessagePortBox.create({
      target: serviceWorker
    }, ctx),
  }, ctx).send(foam.box.Message.create({
    object: foam.box.HelloMessage.create()
  }));

  // Register workers on each others' behalf.
  const channel = new MessageChannel();
  channel.port1.postMessage(foam.json.Network.stringify(
      foam.box.Message.create({
        object: foam.box.RegisterSelfMessage.create({
          name: workerName,
        }),
      })));
  channel.port2.postMessage(foam.json.Network.stringify(
      foam.box.Message.create({
        object: foam.box.RegisterSelfMessage.create({
          name: serviceWorkerName,
        }),
      })));
  worker.postMessage(channel.port1, [channel.port1]);
  serviceWorker.postMessage(channel.port2, [channel.port2]);
};

// When FOAM loads, finish dedicated worker bootstrap (it's name is allocated by
// the in this context). If service worker is loaded, bind dedicated worker to
// service worker.
window._onFOAM = function() {
  workerName = `/worker/${foam.uuid.randomGUID()}`;
  worker.postMessage(workerName);

  ctx = foam.box.Context.create();
  ctx.messagePortService = foam.box.MessagePortService.create({
    source: window,
    delegate: ctx.registry,
  }, ctx);
  foam.box.NamedBox.create({
    name: workerName,
    delegate: foam.box.MessagePortBox.create({
      target: worker
    }, ctx),
  }, ctx).send(foam.box.Message.create({
    object: foam.box.HelloMessage.create()
  }));

  if (serviceWorker) onFOAMAndServiceWorker();
};
