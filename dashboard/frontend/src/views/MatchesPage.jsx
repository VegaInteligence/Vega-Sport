"use client";
import { useSearchParams } from "next/navigation";
import React, { useState } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Empty, Pager, AsyncState } from "../components/UI.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import MatchDetail from "../components/MatchDetail.jsx";
import { useResource, json } from "../services/resources.js";
function RemoteDetail({ id }) {
  const f = useFootball(),
    resource = useResource(`remote-match:${id}`, async () => {
      const record = await json(`/api/archive/matches/${id}`);
      if (record.fixture) return f.client.normalizedRemote(record.fixture);
      return f.client.normalizedRemote(
        (await f.client.request(`matches/${id}`)).data,
      );
    });
  return (
    <AsyncState resource={resource}>
      {(match) => <MatchDetail key={match.id} match={match} />}
    </AsyncState>
  );
}
export default function MatchesPage() {
  const f = useFootball(),
    [page, setPage] = useState(1),
    id = useSearchParams().get("id"),
    selected = f.data.matches.find((m) => m.id === id),
    fixture = f.data.fixtures?.find((m) => m.id === id),
    pages = Math.max(1, Math.ceil(f.matches.length / 30)),
    current = Math.min(page, pages);
  return (
    <Layout
      path="/matchs/"
      title="Matchs"
      filters={!id}
      hideHeading={!!id}
      className={id ? "match-workspace" : ""}
    >
      {id ? (
        <>
          {selected ? (
            <MatchDetail key={selected.id} match={selected} />
          ) : fixture ? (
            <MatchDetail
              key={fixture.id}
              match={f.client.normalizedRemote(fixture)}
            />
          ) : (
            <RemoteDetail id={id} />
          )}
        </>
      ) : (
        <Card title="Matchs collectés">
          {f.matches.slice((current - 1) * 30, current * 30).map((m) => (
            <MatchLink key={m.id} match={m} />
          ))}
          {!f.matches.length && (
            <Empty>Aucun match pour cette recherche.</Empty>
          )}
          <Pager page={current} total={pages} onChange={setPage} />
        </Card>
      )}
    </Layout>
  );
}
