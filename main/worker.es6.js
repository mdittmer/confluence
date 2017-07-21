// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

//
// Dedicated worker for mediating access to DAOs.
//

self.onmessage = event => {
  self.onmessage = null;
  if (!(typeof event.data === 'string'))
    throw new Error('Worker: Expected name as first message');
  const name = event.data;
  const ctx = foam.box.Context.create({ myname: name });
  ctx.messagePortService = foam.box.MessagePortService.create({
    source: self,
    delegate: ctx.registry,
  }, ctx);
};

self.global = self.window = self;
importScripts('./foam.bundle.js');
