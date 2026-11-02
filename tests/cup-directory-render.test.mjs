import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."), require=createRequire(path.join(root,"dashboard/package.json"));
const React=require("react"), {renderToStaticMarkup}=require("react-dom/server"), babel=require("next/dist/compiled/babel/core"), preset=require("next/dist/compiled/babel/preset-react"), commonjs=require("next/dist/compiled/babel/plugin-transform-modules-commonjs"), elem=React.createElement;

test("cup directory groups international tournaments and national cups by country", async () => {
  const cups=await import("../dashboard/frontend/src/services/cup-catalog.js"), selector=await import("../dashboard/frontend/src/services/competition-selector.js");
  const item=(folder,name,country)=>({folder,name,country_code:country,tables:{results:{path:"raw/seasons/2026-2027/a.gz",rows:1}}});
  const catalog=cups.mergeCupCatalog([{id:"l_0bfbkO",name:"Champions League",country:"UEFA",seasons:[]}],{competitions:[item("ESP_CUP_copa-del-rey","Copa del Rey","ESP"),item("ENG_CUP_fa-cup","FA Cup","ENG"),item("GER_CUP_dfb-pokal","DFB Pokal","GER")]},[{id:"l_ABC123",name:"Coupe de Belgique",country:"BEL",seasons:["2026/2027"]},{id:"l_DEF456",name:"Nouvelle coupe mondiale",country:"INT",seasons:["2026"]}]);
  const stubs={"react":React,"./Icon.jsx":{__esModule:true,default:()=>null},"./UI.jsx":{Media:()=>null,Empty:({children})=>elem("p",null,children)},"../services/cup-catalog.js":cups,"../services/competition-selector.js":selector};
  const filename=path.join(root,"dashboard/frontend/src/components/CupDirectory.jsx"),source=await fs.readFile(filename,"utf8"),compiled=babel.transformSync(source,{presets:[[preset,{runtime:"classic"}]],plugins:[commonjs],babelrc:false,configFile:false,filename}).code,mod={exports:{}};
  vm.runInThisContext("(function(require,module,exports){"+compiled+"\n})",{filename})((name)=>{if(!(name in stubs))throw Error("Unexpected import "+name);return stubs[name]},mod,mod.exports);
  const html=renderToStaticMarkup(elem(mod.exports.default,{catalog,onSelect:()=>{},onBack:()=>{}}));
  assert.match(html,/Sélections nationales/);assert.match(html,/Ligue des Nations/);assert.match(html,/Coupes de clubs/);assert.match(html,/Champions League/);assert.match(html,/Coupes nationales/);
  assert.ok(html.indexOf(">Allemagne</h4>")<html.indexOf(">Angleterre</h4>"));assert.ok(html.indexOf(">Angleterre</h4>")<html.indexOf(">Espagne</h4>"));
  assert.match(html,/FA Cup/);assert.match(html,/Coupe du Roi/);assert.match(html,/Coupe de Belgique/);assert.match(html,/Autres coupes internationales/);assert.match(html,/Nouvelle coupe mondiale/);assert.doesNotMatch(html,/national-cup-picker/);
});
