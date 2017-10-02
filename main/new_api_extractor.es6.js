const ogPath = require('process').argv[2];

if (!ogPath) throw new Error('Expected parameter: Path to object graph file');

const ObjectGraph = require('object-graph-js').ObjectGraph;

global.FOAM_FLAGS = {gcloud: true};
require('foam2');

const g = ObjectGraph.fromJSON(require(ogPath));

require('../lib/web_catalog/api_extractor.es6.js');
require('../lib/web_catalog/new_api_extractor.es6.js');
const pkg = org.chromium.apis.web;

const OldApiExtractor = pkg.OldApiExtractor;
const NewApiExtractor = pkg.NewApiExtractor;

function catalogToArray(catalog) {
  const interfaceNames = Object.keys(catalog).sort();
  let ret = [];
  for (const interfaceName of interfaceNames) {
    const apis = catalog[interfaceName].sort();
    for (const apiName of apis) {
      ret.push({interfaceName, apiName});
    }
  }
  return ret;
}

const ctx = foam.__context__.createSubContext({
  objectGraph: g,
});

const old = OldApiExtractor.create(null, ctx).extractWebCatalogAndSources(g);
const nu = NewApiExtractor.create(null, ctx).extractWebCatalogAndSources(g);
const oldAPIs = catalogToArray(old.catalog);
const nuAPIs = catalogToArray(nu.catalog);

let oldIdx = 0;
let nuIdx = 0;

const stream = require('fs').createWriteStream('apiReport.html');
function out(str) {
  stream.write(str);
}

debugger;
out(`<!DOCTYPE HTML>
<html>
<head>
<style>
details { padding: 4px 8px; }
</style>
</head>
<body>`);
while (oldIdx < oldAPIs.length && nuIdx < nuAPIs.length) {
  const oldApi = oldAPIs[oldIdx];
  const nuApi = nuAPIs[nuIdx];
  const oldId = `${oldApi.interfaceName}#${oldApi.apiName}`;
  const nuId = `${nuApi.interfaceName}#${nuApi.apiName}`;
  if (oldId < nuId) {
    // Nu missing oldId.
    out(`<details><summary>Missing ${oldId}</summary>
                     ${pkg.Api.MISSING_TO_HTML(g, oldId, ctx)}
             </details>`);
    oldIdx++;
  } else if (oldId > nuId) {
    // Old missing nuId.
    const nuSource = nu.sources[nuApi.interfaceName][nuApi.apiName];
    const api = pkg.Api.create({
      interfaceName: nuApi.interfaceName,
      apiName: nuApi.apiName,
      sourceObjectGraphId: nuSource,
    }, ctx);
    out(`<details><summary>Added ${nuId}</summary>
                     ${api.toHTML()}
                 </details>`);
                     // ${JSON.stringify(nuApi)}
    nuIdx++;
  } else {
    // Match.
    // out(`<details><summary>Matched ${oldId}</summary></details>`);
    oldIdx++;
    nuIdx++;
  }
}
out(`</body>
</html>`);

stream.end();
