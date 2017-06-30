// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

self.global = self.window = self;
require('../static/bundle/foam.bundle.js');

const ctx = foam.box.Context.create();
ctx.messagePortService.source = self;
