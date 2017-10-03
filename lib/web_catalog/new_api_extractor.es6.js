// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('./api_extractor.es6.js');
require('./post_processors.es6.js');

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'ObjectGraphNode',

  imports: ['objectGraph'],

  properties: [
    {
      class: 'Int',
      name: 'id',
      required: true,
    },
  ],

  methods: [
    function toHTML() {
      const og = this.objectGraph;
      return `<details><summary>${this.id}</summary>
              <p>keys: ${og.getKeys(this.id)
                  .sort((key1, key2) => key1.length - key2.length).join(', ')}
          </details>`;
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'Api',

  requires: ['org.chromium.apis.web.ObjectGraphNode'],

  constants: {
    MISSING_TO_HTML: function(og, apiStr, ctx) {
      const ObjectGraphNode = org.chromium.apis.web.ObjectGraphNode;
      const parts = apiStr.split('#');
      foam.assert(parts.length === 2, 'Expect API description to be "Foo#bar"');
      const interfaceName = parts[0];
      const apiName = parts[1];

      function getRegExp(regExpStr) {
        try {
          return new RegExp(regExpStr);
        } catch (e) { return {test: () => false}; }
      }
      const loose = {list: [], regExp: getRegExp(apiName)};
      const medium = {list: [], regExp: getRegExp(`${interfaceName}.*${apiName}`)};
      const tight = {list: [], regExp: getRegExp(`${interfaceName}\\.${apiName}$`)};

      const allOgIds = og.getAllIds();
      for (const id of allOgIds) {
        if (og.getKeys(id).filter(keyStr => tight.regExp.test(keyStr)).length > 0)
          tight.list.push(id);
        else if (og.getKeys(id).filter(keyStr => medium.regExp.test(keyStr)).length > 0)
          medium.list.push(id);
        else if (og.getKeys(id).filter(keyStr => loose.regExp.test(keyStr)).length > 0)
          loose.list.push(id);
      }

      let str = '';

      if (tight.list.length > 0) {
        str += `<details><summary>Likely</summary>
                        ${tight.list.map(id => ObjectGraphNode.create({id}, ctx).toHTML()).join('')}
                    </details>`;
      }
      if (medium.list.length > 0) {
        str += `<details><summary>Likely</summary>
                        ${medium.list.map(id => ObjectGraphNode.create({id}, ctx).toHTML()).join('')}
                    </details>`;
      }
      if (loose.list.length > 0) {
        str += `<details><summary>Likely</summary>
                        ${loose.list.map(id => ObjectGraphNode.create({id}, ctx).toHTML()).join('')}
                    </details>`;
      }
      return str;
    }
  },

  properties: [
    {
      class: 'String',
      name: 'id',
      expression: function(interfaceName, apiName) {
        return `${interfaceName}#${apiName}`;
      },
    },
    {
      class: 'String',
      name: 'interfaceName',
    },
    {
      class: 'String',
      name: 'apiName',
    },
    {
      class: 'Int',
      name: 'sourceObjectGraphId',
    },
    {
      class: 'FObjectProperty',
      of: 'org.chromium.apis.web.ObjectGraphNode',
      name: 'node',
      expression: function(sourceObjectGraphId) {
        return this.ObjectGraphNode.create({id: sourceObjectGraphId});
      },
    },
  ],

  methods: [
    function toHTML() {
      return `<details><summary>${this.id}</summary>${this.node.toHTML()}</details>`;
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'OldApiExtractor',
  extends: 'org.chromium.apis.web.ApiExtractor',

  methods: [
    {
      name: 'extractWebCatalogAndSources',
      args: [
        {
          name: 'og',
          documentation: `The object graph where the
            Interface and API extracts from`,
          typeName: 'ObjectGraph',
        },
      ],
      code: function(og) {
        const catalog = this.extractWebCatalog(og);
        let sources = {};
        for (const interfaceName in catalog) {
          const interfaceSources = sources[interfaceName] = {};
          const apiNames = catalog[interfaceName];
          for (const apiName of apiNames) {
            interfaceSources[apiName] = 0;
          }
        }
        return {catalog, sources};
      },
    },
  ],
});

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'NewApiExtractor',

  requires: [
    'org.chromium.apis.web.RemoveInterfacesProcessor',
    'org.chromium.apis.web.RemoveApisProcessor',
    'org.chromium.apis.web.AddApiProcessor',
    'org.chromium.apis.web.CopyToPrototypeProcessor',
  ],

  properties: [
    {
      class: 'Boolean',
      name: 'functionNamesFromGraphPaths',
      documentation: `Deduce function names from object graph paths that look
          like "...<Name>.prototype".`,
      value: true,
    },
    {
      class: 'Boolean',
      name: 'classNamesFromConstructorProperty',
      documentation: `Deduce class names the "constructor" property. Not that
          when a constructor is found, other means of deducing class names will
          not run.`,
      value: true,
    },
    {
      class: 'Boolean',
      name: 'classNamesFromGraphPaths',
      documentation: `Deduce class names from object graph paths that look
          like "...<Name>.prototype".`,
      value: true,
    },
    {
      class: 'Boolean',
      name: 'classNamesFromToString',
      documentation: `Deduce class names from object toString() calls that
          yielded "[object SomeClass]" or "[object SomeClassConstructor]" or
          "[object SomeClassPrototype]".`,
      value: true,
    },
    {
      class: 'Array',
      of: 'String',
      name: 'constantTypes',
      documentation: `Properties of these types with writable 0 are filtered
        if retainConstantMembers is false.`,
      factory: function() {
        return ['boolean', 'number', 'string'];
      },
    },
    {
      class: 'Boolean',
      name: 'retainConstantMembers',
      documentation: `Whether or not to retain non-writable properties of types
          in "constantTypes".`,
    },
    {
      name: 'blacklistInterfaces',
      documentation: `Blacklisted interfaces that may be visited in case they
          used for post-processing, but will not be stored.`,
      class: 'StringArray',
      factory: function() {
        return [
          // Stated at https://bugzilla.mozilla.org/show_bug.cgi?id=1290786#c6,
          // CSS2Properties are known bugs for some versions in Firefox.
          // We probably want to exclude them.
          'CSS2Properties',
          // "window" interface stored on "Window" instead. After copying to
          // "Window", remove "window".
          'window',
        ];
      },
    },
    {
      class: 'FObjectArray',
      of: 'org.chromium.apis.web.ApiCatalogPostProcessor',
      name: 'postProcessors',
      factory: function() {
        return [
          // Copy data around before (potentially) removing data that should be
          // copied.
          //
          // Copy processors:
          this.CopyToPrototypeProcessor.create({
            fromInterfaceName: 'CSS2Properties',
            confluenceIssueURL: 'https://github.com/GoogleChrome/confluence/issues/78',
            browserBugURL: 'https://bugzilla.mozilla.org/show_bug.cgi?id=1290786',
          }),
          this.CopyToPrototypeProcessor.create({
            fromInterfaceName: 'window',
          }),

          // Remove processors:
          this.RemoveInterfacesProcessor.create({
            interfaceNames: this.blacklistInterfaces,
          }),
          this.RemoveApisProcessor.create({
            interfaceNames: ['CSSStyleDeclaration'],
            apiNameRegExp: /[-]/,
            confluenceIssueURL: '',
            specURL: 'https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-dashed-attribute',
            otherURLs: [
              'https://github.com/GoogleChrome/confluence/issues/174',
              'https://github.com/w3c/csswg-drafts/issues/1089',
            ],
          }),
        ];
      },
    },
    {
      name: 'fns_',
      documentation: `<Ctor ObjectGraph id> => <interface names>`,
      factory: function() { return {}; },
    },
    {
      name: 'protos_',
      documentation: `<Ctor.prototype ObjectGraph id> => <Ctor ObjectGraph id>`,
      factory: function() { return {}; },
    },
    {
      name: 'sources_',
      documentation: `<Ctor ObjectGraphId> => <apiName> =>
          <source ObjectGraph id>`,
      factory: function() { return {}; },
    },
    {
      name: 'apis_',
      documentation: `<Ctor ObjectGraph id> => <API names>`,
      factory: function() { return {}; },
    },
    {
      class: 'Int',
      name: 'objectDotPrototype_',
    },
    {
      class: 'Int',
      name: 'functionDotPrototype_',
    },
  ],

  methods: [
    function getFunctionNames_(og, id) {
      const keys = og.getKeys(id).map(key => key.split('.'));
      let names = this.functionNamesFromGraphPaths ?
          keys.map(key => key[key.length - 1])
          .filter(name => !/^[+].*[+]$/.test(name))
          .filter(name => name !== 'prototype') : [];
      let nameFromOG = og.getFunctionName(id);
      if (nameFromOG && !names.includes(nameFromOG)) names.push(nameFromOG);
      return names;
    },
    function getClassNames_(og, protoId) {
      if (this.classNamesFromConstructorProperty &&
          og.getObjectKeys(protoId).includes('+constructor+')) {
        return this.getFunctionNames_(og, og.lookup('+constructor+', protoId));
      }

      return this.getCtorNamesFromProto_(og, protoId);
    },
    function getCtorNamesFromProto_(og, protoId) {
      let names = this.classNamesFromGraphPaths ? og.getKeys(protoId)
            .filter(key => key.endsWith('.prototype'))
            .map(key => {
              const parts = key.split('.');
              return parts[parts.length - 2];
            }) : [];
      if (this.classNamesFromToString) {
        let nameFromToString = og.getFunctionName(protoId);
        if (nameFromToString && nameFromToString !== 'Object' &&
            !names.includes(nameFromToString)) {
          names.push(nameFromToString);
        }
      }
      return names;
    },
    function getCtorNameFromToString_(og, protoId) {
      let name = og.getToString(protoId);
      if (!name) return '';
      const match = name.match(/\[object ([A-Za-z_$][0-9A-Za-z_$])*\]/);
      if (match === null) return '';
      name = match[1];
      if (name.endsWith('Prototype'))
        return name.substr(0, name.length - 'Prototype'.length);
      if (name.endsWith('Constructor'))
        return name.substr(0, name.length - 'Constructor'.length);
      return name;
    },
    function isFunctionLike_(og, id) {
      return (!og.isType(id)) &&
          og.getObjectKeys(id).includes('prototype');
    },
    function storeAPIsFromCtor_(og, ctorId) {
      let apis = this.apis_[ctorId] || [];
      // Do not copy "name" or "length" (belonging to Function API) from ctors.
      const newAPIs = this.apisFilter_(
          apis, this.getClassAPIs_(og, ctorId).filter(api => ! [
            'arguments',
            'name',
            'length',
            'caller',
          ].includes(api)));
      let sources = {};
      for (const apiName of newAPIs) {
        sources[apiName] = ctorId;
      }

      // Store all valid API names from ctorId on ctorId's data.
      this.storeSources_(ctorId, sources);
      this.apis_[ctorId] = apis.concat(newAPIs);
    },
    function storeAPIsFromProto_(og, ctorId, protoId) {
      // Gather APIs exposed in prototype chain beneath protoId.
      let lowerProtoId = og.lookup('prototype', ctorId);
      while (lowerProtoId !== protoId) {
        lowerProtoId = og.getPrototype(lowerProtoId);
      }
      let existingAPIs = this.getAllProtosAPIs_(og, lowerProtoId);

      // Add to existingAPIs: APIs already registered to ctorId.
      const ctorAPIs = this.apis_[ctorId] = this.apis_[ctorId] || [];
      existingAPIs = this.apisConcat_(existingAPIs, ctorAPIs);

      // Add to ctorId: New APIs that:
      // (1) Are not exposed by some interface lower level than protoId's, AND
      // (2) Are not already on ctorId.
      let sources = {};
      const newAPIs = this.apisFilter_(existingAPIs,
                                       this.getClassAPIs_(og, protoId));
      for (const apiName of newAPIs) {
        sources[apiName] = protoId;
      }
      this.storeSources_(ctorId, sources);
      this.apis_[ctorId] = ctorAPIs.concat(newAPIs);
    },
    function getAllProtosAPIs_(og, id) {
      let lowerProtoId = og.getPrototype(id);
      let apis = [];
      while (!og.isType(lowerProtoId)) {
        apis = this.apisConcat_(apis, this.getClassAPIs_(og, lowerProtoId));
        lowerProtoId = og.getPrototype(lowerProtoId);
      }
      return apis;
    },
    function storeAPIsFromArray_(og, ctorId, arr) {
      let apis = this.apis_[ctorId] = this.apis_[ctorId] || [];
      this.apis_[ctorId] = this.apisConcat_(apis, arr);
    },
    function getClassAPIs_(og, id) {
      if (id === this.objectDotPrototype_) {
        // Object.prototype: Store "marked-as-built-in" APIs with "+apiName+".
        return og.getObjectKeys(id)
            .filter(name => name !== 'prototype')
            .filter(this.filterConstantAPIs_.bind(this, og, id))
            .map(name => {
              const match = name.match(/^[+](.*)[+]$/);
              if (match === null) return name;
              return match[1];
            });
      }
      if (id === this.functionDotPrototype_) {
        // Function.prototype: Include non-writable APIs and "prototype" API.
        return og.getObjectKeys(id).filter(name => !/^[+].*[+]$/.test(name));
      }
      // Default: Exclude:
      // (1) object-graph'ified properties "+reservedName+",
      // (2) integers,
      // (3) the "prototype" property,
      // (4) uninteresting constants.
      return og.getObjectKeys(id)
          .filter(name => !/^[+].*[+]$/.test(name))
          .filter(name => !/^[0-9]+$/.test(name))
          .filter(name => name !== 'prototype')
          .filter(this.filterConstantAPIs_.bind(this, og, id));
    },
    function getInstanceAPIs_(og, id) {
      // Exclude object-graph'ified properties "+reservedName+" and integers.
      return og.getObjectKeys(id)
          .filter(name => !/^[+].*[+]$/.test(name))
          .filter(name => !/^[0-9]+$/.test(name));
    },
    function filterConstantAPIs_(og, id, name) {
      if (this.retainConstantMembers) return true;
      const nameId = og.lookup(name, id);
      return !(this.constantTypes.indexOf(og.getType(nameId)) !== -1 &&
               og.lookupMetaData(name, id).value === 1);
    },
    function apisConcat_(arr1, arr2) {
      // Filter upon concatenation.
      return arr1.concat(this.apisFilter_(arr1, arr2));
    },
    function apisFilter_(arr1, arr2) {
      // Filter for adding arr2 to arr1 of APIs: dedup string API names.
      return arr2.filter(apiName => !arr1.includes(apiName));
    },
    function storeSources_(id, sources) {
      // Existing overwrites new sources.
      const existing = this.sources_[id];
      this.sources_[id] = existing ?
          Object.assign(sources, existing) : sources;
    },
    {
      name: 'extractWebCatalogAndSources',
      args: [
        {
          name: 'og',
          documentation: `The object graph where the
            Interface and API extracts from`,
          typeName: 'ObjectGraph',
        },
      ],
      code: function(og) {
        const catalog = this.extractWebCatalog(og);
        let sources = {};

        // Store default "hasOwnProperty" when deailing with structures that may
        // override it to provide data about "hasOwnProperty" as an API.
        const hap = function(o, p) {
          return Object.prototype.hasOwnProperty.call(o, p);
        };

        for (const id in this.sources_) {
          if (!hap(this.sources_, id)) continue;
          const interfaceNames = this.fns_[id];
          if (!interfaceNames || interfaceNames.length === 0) continue;

          const interfaceSources = this.sources_[id];
          for (const interfaceName of interfaceNames) {
            sources[interfaceName] = hap(sources, interfaceName) ?
                sources[interfaceName] : {};
            for (const apiName in interfaceSources) {
              if (!hap(interfaceSources, apiName)) continue;
              sources[interfaceName][apiName] = interfaceSources[apiName];
            }
          }
        }
        return {catalog, sources};
      },
    },
    {
      name: 'extractWebCatalog',
      documentation: `This function reads an object graph and produce
        a web catalog JSON.`,
      args: [
        {
          name: 'og',
          documentation: `The object graph where the
            Interface and API extracts from`,
          typeName: 'ObjectGraph',
        },
      ],
      code: function(og) {
        this.objectDotPrototype_ = og.lookup('Object.prototype');
        this.functionDotPrototype_ = og.lookup('Function.prototype');

        // Gather functions.
        const allOgIds = og.getAllIds();
        for (const id of allOgIds) {
          if (this.isFunctionLike_(og, id)) {
            const proto = og.lookup('prototype', id);
            const names = this.getFunctionNames_(og, id);
            this.protos_[proto] = id;
            this.fns_[id] = [];
            for (const name of names) {
              this.fns_[id].push(name);
            }
          }
        }

        // Gather "global libraries".
        const globalNames = og.getObjectKeys(og.getRoot());
        for (const name of globalNames) {
          const id = og.lookup(name);
          if (!this.isFunctionLike_(og, id)) {
            let names = this.getClassNames_(og, id);
            if (!names.includes(name)) names.push(name);
            // Libraries are like functions where the constructor and the
            // prototype are the same object.
            this.fns_[id] = names;
            this.protos_[id] = id;
          }
        }

        // Gather APIs on function/prototype pairs.
        for (const id of allOgIds) {
          // Functions are interfaces, not prototypes. Just store properties and
          // carry on.
          if (this.fns_[id]) {
            this.storeAPIsFromCtor_(og, id);
            continue;
          }

          if (this.protos_.hasOwnProperty(id)) {
            // This is a "Foo.prototype". Store its properties under "Foo",
            // and pull up any of its prototype's properties, so long as those
            // prototypes are not some "Bar.prototype".
            const ctorId = this.protos_[id];
            const ctorNames = this.getFunctionNames_(og, ctorId);
            let protoId = id;
            let protoNames = this.getClassNames_(og, protoId);
            // Stop "pulling up" prototype's properties if:
            // (1) Prototype is "type" instead of object description
            //     (e.g., is null); or
            // (2) Prototype is known to belong to another class
            //     (this.protos_[protoId] is truthy and not ctorId), and there
            //     is no overlap between ctorId's function names and protoId's
            //     class names.
            while (!og.isType(protoId) &&
                   (this.protos_[protoId] === ctorId ||
                    (!this.protos_[protoId]) ||
                    ctorNames.some(ctorName => protoNames.includes(ctorName)))) {
              this.storeAPIsFromProto_(og, ctorId, protoId);
              protoId = og.getPrototype(protoId);
              protoNames = this.getClassNames_(og, protoId);
            }
          } // else: This is an instance or a primitive value.
        }

        // Copy APIs from instances down to closest interface prototype iff the
        // API does not exist further down in the prototype chain.
        for (const id of allOgIds) {
          if ((!this.fns_[id]) && (!this.protos_.hasOwnProperty(id)) &&
              (!og.isType(id))) {
            // This is some sort of "instance". Attempt to copy it (and its
            // prototype's) properties down to some "Foo.prototype" in its
            // prototype chain.
            let ctorId = this.protos_[id];
            let protoId = id;
            let apis = [];
            let sources = {};
            while (!og.isType(protoId) && !ctorId) {
              // Existing APIs are:
              // (1) APIs already found above "protoId in prototype chain +
              // (2) APIs below "protoId" in prototype chain.
              const existingAPIs = this.apisConcat_(
                  apis, this.getAllProtosAPIs_(og, protoId));
              const newAPIs = this.apisFilter_(existingAPIs,
                                               this.getInstanceAPIs_(
                                                   og, protoId));
              for (const apiName of newAPIs) {
                sources[apiName] = protoId;
              }
              apis = apis.concat(newAPIs);
              ctorId = this.protos_[protoId];
              protoId = og.getPrototype(protoId);
            }
            if (!og.isType(protoId)) {
              this.storeSources_(ctorId, sources);
              this.storeAPIsFromArray_(og, ctorId, apis);
            }
          } // else: This is a primitive value.
        }

        let apiCatalog = {};
        for (const fnId in this.fns_) {
          if (this.apis_[fnId] && this.apis_[fnId].length > 0) {
            const names = this.fns_[fnId];
            for (const name of names) {
              apiCatalog[name] = this.apis_[fnId];
            }
          }
        }

        this.postProcess_(apiCatalog, og);

        return apiCatalog;
      },
    },
    {
      name: 'postProcess_',
      documentation: `Perform post-processing steps after initial extraction.`,
      args: [
        {
          documentation: `The json stores interface and API data.`,
          name: 'apiCatalog',
          typeName: 'JSON',
        },
        {
          documentation: `The object graph.`,
          name: 'og',
          typeName: 'ObjectGraph',
        },
      ],
      code: function(apiCatalog, og) {
        for (let i = 0; i < this.postProcessors.length; i++) {
          this.postProcessors[i].postProcess(apiCatalog, og);
        }
      },
    },
  ],
});
