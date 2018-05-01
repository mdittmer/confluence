
// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('../lib/compat.es6.js');
require('../lib/dao_container.es6.js');
require('../lib/indexed_dao.es6.js');
require('../lib/web_apis/api_compat_data.es6.js');
require('../lib/worker_dao.es6.js');
const pkg = org.chromium.apis.web;

const ctx = foam.box.Context.create({
  myname: '/page',
  unsafe: false,
  classWhitelist: require('../data/class_whitelist.json'),
});

const stubFactory = foam.core.StubFactorySingleton.create();
const Worker = require('./worker2.es6.js');
let workers = [];
let workerDAOs = {};
const getWorkerDAO = (name, cls, ctx) => {
  const boxURL = `/worker/${name}`;
  if (workerDAOs[boxURL]) return workerDAOs[boxURL];

  const worker = new Worker();
  workers.push(worker);

  // First message to worker before foam.box.Context takes over:
  // "what is your name" message.
  worker.postMessage({name: boxURL});

  const workerMessagePortBox = foam.box.MessagePortBox.create({
    target: worker,
  }, ctx);

  // TODO(markdittmer): This forces the MessagePort handshake to begin
  // immediately. There should probably be an API for this instead.
  workerMessagePortBox.delegate;

  const namedBox = foam.box.NamedBox.create({
    name: boxURL,
    delegate: workerMessagePortBox,
  }, ctx);

  const workerRegistry = stubFactory.get(foam.box.BoxRegistry).create({
    delegate: namedBox,
  }, ctx);

  const workerDAO = pkg.WorkerDAO.create({
    of: pkg.generated.CompatData,
    name,
  }, ctx);

  const localStubDAO = foam.dao.ClientDAO.create({
    delegate: workerRegistry.register('dao', null, foam.box.SkeletonBox.create({
      data: workerDAO,
    }, ctx)),
  }, ctx);

  workerDAOs[boxURL] = localStubDAO;
  return localStubDAO;
};

const getLocalDAO = (name, cls, ctx) => {
  return foam.dao.RestDAO.create({
    baseURL: `${self.location.origin}/${name}`,
    of: cls,
  }, ctx);
};

const compatClassURL = `${window.location.origin}/${pkg.DAOContainer.COMPAT_MODEL_FILE_NAME}`;
pkg.ClassGenerator.create({
  classURL: compatClassURL,
}).generateClass().then(() => {
  console.log('Initializing DAO', performance.now());
  const workerDAO = 
      getWorkerDAO(pkg.DAOContainer.COMPAT_NAME, pkg.generated.CompatData, ctx);
  const localDAO = getLocalDAO(pkg.DAOContainer.COMPAT_NAME, pkg.generated.CompatData, ctx);

  const proxyDAO = foam.dao.ProxyDAO.create({delegate: localDAO}, ctx);
  
  proxyDAO.limit(200).select().then(() => {
    console.log('Initial results', performance.now());
  });

  workerDAO.limit(1).select().then(() => {
    console.log('Cache initialized', performance.now());
    proxyDAO.delegate = workerDAO;
  })
});
