// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

//
// Service worker script for background sync.
//

self.global = self.window = self;
importScripts('./foam.bundle.js');

const ctx = foam.box.Context.create({
  myname: require('../lib/names.es6.js').SERVICE_WORKER_BOX_CONTEXT_NAME,
});
ctx.messagePortService = foam.box.MessagePortService.create({
  source: self,
  delegate: ctx.registry,
}, ctx);
