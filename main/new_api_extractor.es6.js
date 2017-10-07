const ogPaths = require('process').argv.slice(2);

if (!ogPaths) throw new Error('Expected parameter: Path to object graph file');

const ObjectGraph = require('object-graph-js').ObjectGraph;

global.FOAM_FLAGS = {gcloud: true};
require('foam2');

const gs = ogPaths.map(path => {
  return {path, graph: ObjectGraph.fromJSON(require(path))};
});

require('../lib/web_catalog/api_extractor.es6.js');
const pkg = org.chromium.apis.web;

const ApiExtractor = pkg.ApiExtractor;

function catalogToArray(catalog) {
  const interfaceNames = Object.keys(catalog).sort();
  let ret = [];
  for (const interfaceName of interfaceNames) {
    const apis = catalog[interfaceName].sort();
    for (const apiName of apis) {
      ret.push(`${interfaceName}#${apiName}`);
      // ret.push({interfaceName, apiName});
    }
  }
  return ret;
}

for (const g of gs) {
  const ctx = foam.__context__.createSubContext({
    objectGraph: g.graph,
  });

  const catalog = ApiExtractor.create(null, ctx).extractWebCatalog(g.graph);

  const fs = require('fs');
  // fs.writeFileSync(`${ogPath}.old_apis.json`, JSON.stringify(oldAPIs, null, 2));
  // fs.writeFileSync(`${ogPath}.new_apis.json`, JSON.stringify(nuAPIs, null, 2));
  // fs.writeFileSync(`${ogPath}.old_apis.txt`, JSON.stringify(oldAPIs, null, 2));
  fs.writeFileSync(`${g.path}.new_apis.txt`, JSON.stringify(catalogToArray(catalog), null, 2));
}
// const stream = require('fs').createWriteStream('apiReport.html');
// function out(str) {
//   stream.write(str);
// }
// out(`<!DOCTYPE HTML>
// <html>
// <head>
// <style>
// details { padding: 4px 8px; }
// </style>
// </head>
// <body>`);

// let oldIdx = 0;
// let nuIdx = 0;
// let startChar = oldAPIs[0].interfaceName.charAt(0) <
//     nuAPIs[0].interfaceName.charAt(0) ?
//     oldAPIs[0].interfaceName.charAt(0) :
//     nuAPIs[0].interfaceName.charAt(0);
// let startCharCounter = 0;
// out(`<details><summary>${startChar}...</summary>`);

// while (oldIdx < oldAPIs.length && nuIdx < nuAPIs.length) {
//   const oldApi = oldAPIs[oldIdx];
//   const nuApi = nuAPIs[nuIdx];

//   const oldStart = oldApi.interfaceName.charAt(0);
//   const nuStart = nuApi.interfaceName.charAt(0);
//   if (oldStart > startChar && nuStart > startChar) {
//     startCharCounter = (startCharCounter + 1) % 8;
//     if (startCharCounter === 0) {
//       startChar = oldStart < nuStart ? oldStart : nuStart;
//       out(`</details><details><summary>${startChar}...</summary>`);
//     }
//   }

//   const oldId = `${oldApi.interfaceName}#${oldApi.apiName}`;
//   const nuId = `${nuApi.interfaceName}#${nuApi.apiName}`;

//   if (oldId < nuId) {
//     // Nu missing oldId.
//     out(`<details><summary>Missing ${oldId}</summary>
//                      ${pkg.Api.MISSING_TO_HTML(g, oldId, ctx)}
//              </details>`);
//     oldIdx++;
//   } else if (oldId > nuId) {
//     // Old missing nuId.
//     const nuSource = nu.sources[nuApi.interfaceName][nuApi.apiName];
//     const api = pkg.Api.create({
//       interfaceName: nuApi.interfaceName,
//       apiName: nuApi.apiName,
//       sourceObjectGraphId: nuSource,
//     }, ctx);
//     out(`<details><summary>Added ${nuId}</summary>
//                      ${api.toHTML()}
//                  </details>`);
//                      // ${JSON.stringify(nuApi)}
//     nuIdx++;
//   } else {
//     // Match.
//     // out(`<details><summary>Matched ${oldId}</summary></details>`);
//     oldIdx++;
//     nuIdx++;
//   }
// }
// out(`</details>
// </body>
// </html>`);

// stream.end();
