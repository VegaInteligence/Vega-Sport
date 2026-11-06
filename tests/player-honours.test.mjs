import test from "node:test";
import assert from "node:assert/strict";
import {loadPlayerHonours} from "../dashboard/frontend/src/services/player-honours.js";
import {curatedProjections,MESSI_ID} from "../dashboard/scripts/materialize_curated.mjs";

test("published honours preserve curated editions and verified source identity",async()=>{
  const source={available:true,sourceUrl:"https://en.wikipedia.org/wiki/Lionel_Messi",honours:[{name:"MLS Cup",team:"Inter Miami",category:"team",seasons:["2025"]}]};
  const [{body}]=curatedProjections(source);
  const {groups,sourceUrl}=await loadPlayerHonours(MESSI_ID,"Lionel Messi",async()=>Response.json(body));
  assert.deepEqual(groups,body.displayGroups);assert.equal(sourceUrl,source.sourceUrl);
  const items=groups.flatMap(g=>g.items);
  assert.equal(items.find(item=>item.title==="Ballon d’Or").count,8);
  assert.equal(items.find(item=>item.title==="Coupe du monde").years,"2022");
  assert.ok(items.find(item=>item.title==="MLS Cup").years.includes("2025"));
});
test("a database miss cannot trigger a client-side identity or provider lookup",async()=>{
  for(const player of [MESSI_ID,"p_123456"]){
    const calls=[];
    const result=await loadPlayerHonours(player,"Unknown",async url=>{calls.push(url);return new Response(null,{status:404});});
    assert.deepEqual(result.groups,[]);assert.deepEqual(calls,["/api/player-honours?id="+player]);
  }
});

test("Yamal's published team honours retain every edition with French labels", async () => {
  const honours = [
    {
      category: "team",
      name: "La Liga",
      team: "Barcelona",
      seasons: ["2022–23", "2024–25", "2025–26"],
    },
    {
      category: "team",
      name: "UEFA European Championship",
      team: "Spain",
      seasons: ["2024"],
    },
    {
      category: "team",
      name: "FIFA World Cup",
      team: "Spain",
      seasons: ["2026"],
    },
  ];
  const result = await loadPlayerHonours("p_2e0FPo", "Lamine Yamal", async () =>
    Response.json({ available: true, honours }),
  );
  assert.deepEqual(result.groups, [
    {
      group: "FC Barcelone",
      items: [{ title: "Liga", count: 3, years: "2025–26, 2024–25, 2022–23" }],
    },
    {
      group: "Espagne",
      items: [
        { title: "Euro", count: 1, years: "2024" },
        { title: "Coupe du monde", count: 1, years: "2026" },
      ],
    },
  ]);
});
