"""A small Fjelstul World Cup Database, in the files and columns of the real one (github.com/jfjelstul/worldcup,
data-csv/): what the worldcup adapter reads, with the cases its rules exist for.

- a men's tournament (1974) and a women's (1991): the base holds no women's World Cup, its matches pair with nothing;
- a final the base lists in the other team order, and a match of « United States », which the base's source spells « USA »;
- a player known by one name (« not applicable » as given name), a birth date « not available », a shirt number 0;
- an own goal (credited to the other team), a goal in stoppage time, a second yellow card, a substitution (two rows),
  a shoot-out kick missed, a shared award.
"""

import csv
import hashlib
import io

HEADERS = {
    "tournaments": "key_id,tournament_id,tournament_name,year,start_date,end_date,host_country,winner,host_won,count_teams,group_stage,second_group_stage,final_round,round_of_16,quarter_finals,semi_finals,third_place_match,final",
    "teams": "key_id,team_id,team_name,team_code,mens_team,womens_team,federation_name,region_name,confederation_id,confederation_name,confederation_code,mens_team_wikipedia_link,womens_team_wikipedia_link,federation_wikipedia_link",
    "stadiums": "key_id,stadium_id,stadium_name,city_name,country_name,stadium_capacity,stadium_wikipedia_link,city_wikipedia_link",
    "players": "key_id,player_id,family_name,given_name,birth_date,female,goal_keeper,defender,midfielder,forward,count_tournaments,list_tournaments,player_wikipedia_link",
    "managers": "key_id,manager_id,family_name,given_name,female,country_name,manager_wikipedia_link",
    "referees": "key_id,referee_id,family_name,given_name,female,country_name,confederation_id,confederation_name,confederation_code,referee_wikipedia_link",
    "matches": "key_id,tournament_id,tournament_name,match_id,match_name,stage_name,group_name,group_stage,knockout_stage,replayed,replay,match_date,match_time,stadium_id,stadium_name,city_name,country_name,home_team_id,home_team_name,home_team_code,away_team_id,away_team_name,away_team_code,score,home_team_score,away_team_score,home_team_score_margin,away_team_score_margin,extra_time,penalty_shootout,score_penalties,home_team_score_penalties,away_team_score_penalties,result,home_team_win,away_team_win,draw",
    "squads": "key_id,tournament_id,tournament_name,team_id,team_name,team_code,player_id,family_name,given_name,shirt_number,position_name,position_code",
    "player_appearances": "key_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,team_id,team_name,team_code,home_team,away_team,player_id,family_name,given_name,shirt_number,position_name,position_code,starter,substitute",
    "manager_appearances": "key_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,team_id,team_name,team_code,home_team,away_team,manager_id,family_name,given_name,country_name",
    "referee_appearances": "key_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,referee_id,family_name,given_name,country_name,confederation_id,confederation_name,confederation_code",
    "goals": "key_id,goal_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,team_id,team_name,team_code,home_team,away_team,player_id,family_name,given_name,shirt_number,player_team_id,player_team_name,player_team_code,minute_label,minute_regulation,minute_stoppage,match_period,own_goal,penalty",
    "bookings": "key_id,booking_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,team_id,team_name,team_code,home_team,away_team,player_id,family_name,given_name,shirt_number,minute_label,minute_regulation,minute_stoppage,match_period,yellow_card,red_card,second_yellow_card,sending_off",
    "substitutions": "key_id,substitution_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,team_id,team_name,team_code,home_team,away_team,player_id,family_name,given_name,shirt_number,minute_label,minute_regulation,minute_stoppage,match_period,going_off,coming_on",
    "penalty_kicks": "key_id,penalty_kick_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,team_id,team_name,team_code,home_team,away_team,player_id,family_name,given_name,shirt_number,converted",
    "awards": "key_id,award_id,award_name,award_description,year_introduced",
    "award_winners": "key_id,tournament_id,tournament_name,award_id,award_name,shared,player_id,family_name,given_name,team_id,team_name,team_code",
}

MEN, WOMEN = "1974 FIFA Men's World Cup", "1991 FIFA Women's World Cup"
NED, FRG, USA, SWE = ("T-01", "Netherlands", "NED"), ("T-02", "West Germany", "DEU"), ("T-03", "United States", "USA"), ("T-04", "Sweden", "SWE")
FINAL = ("WC-1974", MEN, "M-1974-38", "Netherlands vs West Germany", "1974-07-07", "final", "not applicable")
GROUP = ("WC-1974", MEN, "M-1974-01", "United States vs Sweden", "1974-06-14", "group stage", "Group 1")
LADIES = ("WC-1991", WOMEN, "M-1991-01", "Sweden vs United States", "1991-11-17", "group stage", "Group B")

# Rows by file: only the columns named here are filled, the others are empty (the adapter reads these).
ROWS = {
    "tournaments": [
        dict(tournament_id="WC-1974", tournament_name=MEN, year="1974", start_date="1974-06-13", end_date="1974-07-07", host_country="West Germany", winner="West Germany", count_teams="16"),
        dict(tournament_id="WC-1991", tournament_name=WOMEN, year="1991", start_date="1991-11-16", end_date="1991-11-30", host_country="China", winner="United States", count_teams="12"),
    ],
    "teams": [dict(team_id=k, team_name=n, team_code=c, mens_team="1", womens_team="1" if k in ("T-03", "T-04") else "0", confederation_code="UEFA" if k != "T-03" else "CONCACAF") for k, n, c in (NED, FRG, USA, SWE)],
    "stadiums": [dict(stadium_id="S-001", stadium_name="Olympiastadion", city_name="Munich", country_name="West Germany", stadium_capacity="77573", stadium_wikipedia_link="https://en.wikipedia.org/wiki/Olympiastadion_(Munich)"),
                 dict(stadium_id="S-002", stadium_name="Tianhe Stadium", city_name="Guangzhou", country_name="China", stadium_capacity="60000")],
    "players": [
        dict(player_id="P-00001", family_name="Cruyff", given_name="Johan", birth_date="1947-04-25", female="0", forward="1", goal_keeper="0", defender="0", midfielder="0", player_wikipedia_link="https://en.wikipedia.org/wiki/Johan_Cruyff"),
        dict(player_id="P-00002", family_name="Müller", given_name="Gerd", birth_date="1945-11-03", female="0", forward="1", goal_keeper="0", defender="0", midfielder="0"),
        dict(player_id="P-00003", family_name="Jairzinho", given_name="not applicable", birth_date="not available", female="0", forward="1", goal_keeper="0", defender="0", midfielder="0"),
        dict(player_id="P-00004", family_name="Akers", given_name="Michelle", birth_date="1966-02-01", female="1", forward="1", goal_keeper="0", defender="0", midfielder="0"),
    ],
    "managers": [dict(manager_id="M-001", family_name="Michels", given_name="Rinus", female="0", country_name="Netherlands"), dict(manager_id="M-002", family_name="Schön", given_name="Helmut", female="0", country_name="West Germany")],
    "referees": [dict(referee_id="R-001", family_name="Taylor", given_name="Jack", female="0", country_name="England", confederation_code="UEFA")],
    "matches": [
        dict(zip(("tournament_id", "tournament_name", "match_id", "match_name", "match_date", "stage_name", "group_name"), FINAL), replayed="0", replay="0", match_time="16:00", stadium_id="S-001",
             home_team_id="T-01", home_team_name="Netherlands", away_team_id="T-02", away_team_name="West Germany", home_team_score="1", away_team_score="2", extra_time="0", penalty_shootout="0",
             home_team_score_penalties="0", away_team_score_penalties="0"),
        dict(zip(("tournament_id", "tournament_name", "match_id", "match_name", "match_date", "stage_name", "group_name"), GROUP), replayed="0", replay="0", match_time="19:30", stadium_id="S-001",
             home_team_id="T-03", home_team_name="United States", away_team_id="T-04", away_team_name="Sweden", home_team_score="1", away_team_score="1", extra_time="1", penalty_shootout="1",
             home_team_score_penalties="4", away_team_score_penalties="5"),
        dict(zip(("tournament_id", "tournament_name", "match_id", "match_name", "match_date", "stage_name", "group_name"), LADIES), replayed="0", replay="0", match_time="19:45", stadium_id="S-002",
             home_team_id="T-04", home_team_name="Sweden", away_team_id="T-03", away_team_name="United States", home_team_score="2", away_team_score="3", extra_time="0", penalty_shootout="0",
             home_team_score_penalties="0", away_team_score_penalties="0"),
    ],
    "squads": [
        dict(tournament_id="WC-1974", team_id="T-01", player_id="P-00001", shirt_number="14", position_name="forward", position_code="FW"),
        dict(tournament_id="WC-1974", team_id="T-02", player_id="P-00002", shirt_number="13", position_name="forward", position_code="FW"),
        dict(tournament_id="WC-1974", team_id="T-02", player_id="P-00003", shirt_number="0", position_name="forward", position_code="FW"),
        dict(tournament_id="WC-1991", team_id="T-03", player_id="P-00004", shirt_number="10", position_name="forward", position_code="FW"),
    ],
    "player_appearances": [
        dict(match_id="M-1974-38", team_id="T-01", player_id="P-00001", shirt_number="14", position_name="forward", position_code="FW", starter="1", substitute="0"),
        dict(match_id="M-1974-38", team_id="T-02", player_id="P-00002", shirt_number="13", position_name="centre forward", position_code="CF", starter="1", substitute="0"),
        dict(match_id="M-1974-38", team_id="T-02", player_id="P-00003", shirt_number="20", position_name="forward", position_code="FW", starter="0", substitute="1"),
    ],
    "manager_appearances": [dict(match_id="M-1974-38", team_id="T-01", manager_id="M-001"), dict(match_id="M-1974-38", team_id="T-02", manager_id="M-002")],
    "referee_appearances": [dict(match_id="M-1974-38", referee_id="R-001")],
    "goals": [
        dict(goal_id="G-0001", match_id="M-1974-38", team_id="T-01", player_id="P-00001", player_team_id="T-01", minute_label="2'", minute_regulation="2", minute_stoppage="0", match_period="first half", own_goal="0", penalty="1"),
        dict(goal_id="G-0002", match_id="M-1974-38", team_id="T-02", player_id="P-00002", player_team_id="T-02", minute_label="45'+1'", minute_regulation="45", minute_stoppage="1", match_period="first half, stoppage time", own_goal="0", penalty="0"),
        dict(goal_id="G-0003", match_id="M-1974-38", team_id="T-02", player_id="P-00001", player_team_id="T-01", minute_label="60'", minute_regulation="60", minute_stoppage="0", match_period="second half", own_goal="1", penalty="0"),
    ],
    "bookings": [
        dict(booking_id="B-0001", match_id="M-1974-38", team_id="T-01", player_id="P-00001", minute_label="23'", minute_regulation="23", minute_stoppage="0", match_period="first half", yellow_card="1", red_card="0", second_yellow_card="0", sending_off="0"),
        dict(booking_id="B-0002", match_id="M-1974-38", team_id="T-01", player_id="P-00001", minute_label="80'", minute_regulation="80", minute_stoppage="0", match_period="second half", yellow_card="1", red_card="0", second_yellow_card="1", sending_off="1"),
    ],
    "substitutions": [
        dict(substitution_id="S-0001", match_id="M-1974-38", team_id="T-02", player_id="P-00002", minute_label="68'", minute_regulation="68", minute_stoppage="0", match_period="second half", going_off="1", coming_on="0"),
        dict(substitution_id="S-0002", match_id="M-1974-38", team_id="T-02", player_id="P-00003", minute_label="68'", minute_regulation="68", minute_stoppage="0", match_period="second half", going_off="0", coming_on="1"),
    ],
    "penalty_kicks": [dict(penalty_kick_id="PK-001", match_id="M-1974-01", team_id="T-04", player_id="P-00002", converted="1"), dict(penalty_kick_id="PK-002", match_id="M-1974-01", team_id="T-03", player_id="P-00003", converted="0")],
    "awards": [dict(award_id="A-1", award_name="Golden Ball", award_description="The best player of the tournament", year_introduced="1982")],
    "award_winners": [dict(tournament_id="WC-1974", award_id="A-1", shared="1", player_id="P-00001", team_id="T-01")],
}


def texts(rows=None):
    """{file name: its CSV text}, as the repository serves them."""
    out = {}
    for name, header in HEADERS.items():
        columns = header.split(",")
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(columns)
        for index, row in enumerate((rows or ROWS)[name], start=1):
            writer.writerow([str(index) if column == "key_id" else row.get(column, "") for column in columns])
        out[name] = buffer.getvalue()
    return out


def digests(files):
    return {name: hashlib.sha256(text.encode("utf-8")).hexdigest() for name, text in files.items()}
