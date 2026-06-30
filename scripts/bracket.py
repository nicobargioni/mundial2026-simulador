"""Deterministic 2026 World Cup bracket reconstruction from the official dataset.
Groups + letters verified against Wikipedia group subpages."""
import pandas as pd

GROUPS = {
 'A': ['Czech Republic','Mexico','South Africa','South Korea'],
 'B': ['Bosnia and Herzegovina','Canada','Qatar','Switzerland'],
 'C': ['Brazil','Haiti','Morocco','Scotland'],
 'D': ['Australia','Paraguay','Turkey','United States'],
 'E': ['Curaçao','Ecuador','Germany','Ivory Coast'],
 'F': ['Japan','Netherlands','Sweden','Tunisia'],
 'G': ['Belgium','Egypt','Iran','New Zealand'],
 'H': ['Cape Verde','Saudi Arabia','Spain','Uruguay'],
 'I': ['France','Iraq','Norway','Senegal'],
 'J': ['Algeria','Argentina','Austria','Jordan'],
 'K': ['Colombia','DR Congo','Portugal','Uzbekistan'],
 'L': ['Croatia','England','Ghana','Panama'],
}

def group_standings(grp_df):
    """Return {group_letter: [team_1st, team_2nd, team_3rd, team_4th]}."""
    res = {}
    for L, teams in GROUPS.items():
        tbl = {t: {'P':0,'GF':0,'GA':0} for t in teams}
        sub = grp_df[(grp_df.home_team.isin(teams)) & (grp_df.away_team.isin(teams))]
        for _, r in sub.iterrows():
            hs, a = int(r.home_score), int(r.away_score)
            tbl[r.home_team]['GF']+=hs; tbl[r.home_team]['GA']+=a
            tbl[r.away_team]['GF']+=a;  tbl[r.away_team]['GA']+=hs
            if hs>a:   tbl[r.home_team]['P']+=3
            elif hs<a: tbl[r.away_team]['P']+=3
            else: tbl[r.home_team]['P']+=1; tbl[r.away_team]['P']+=1
        order = sorted(teams, key=lambda t:(tbl[t]['P'], tbl[t]['GF']-tbl[t]['GA'], tbl[t]['GF']), reverse=True)
        res[L] = order
    return res

# Official 2026 R32 template (group-position slots). 'W'=winner,'R'=runner-up,'3'=third placeholder.
R32_TEMPLATE = {
 73:('R','A','R','B'), 74:('W','E','3',None), 75:('W','F','R','C'), 76:('W','C','R','F'),
 77:('W','I','3',None), 78:('R','E','R','I'), 79:('W','A','3',None), 80:('W','L','3',None),
 81:('W','D','3',None), 82:('W','G','3',None), 83:('R','K','R','L'), 84:('W','H','R','J'),
 85:('W','B','3',None), 86:('W','J','R','H'), 87:('W','K','3',None), 88:('R','D','R','G'),
}
# R16 -> Final tree (winner of match X)
R16 = {89:(75,78),90:(79,80),91:(81,82),92:(83,84),93:(85,87),94:(86,88),95:(73,74),96:(76,77)}
QF  = {97:(89,90),98:(93,94),99:(91,92),100:(95,96)}
SF  = {101:(97,98),102:(99,100)}
FINAL = (101,102)

def known_team(slot, standings):
    typ, grp = slot[0], slot[1]
    if typ=='W': return standings[grp][0]
    if typ=='R': return standings[grp][1]
    return None  # third placeholder

def build_bracket(grp_df, r32_actual):
    """r32_actual: list of (home, away) for the 16 R32 matchups (teams).
    Returns dict match_number -> (teamA, teamB)."""
    st = group_standings(grp_df)
    # For each template match, the non-third slots identify the match by team.
    # Build lookup: team -> set of match numbers where it's a fixed (W/R) slot.
    fixed = {}  # match_num -> list of fixed team names
    for m, (t1,g1,t2,g2) in R32_TEMPLATE.items():
        ft = []
        if t1 in ('W','R'): ft.append(st[g1][0 if t1=='W' else 1])
        if t2 in ('W','R'): ft.append(st[g2][0 if t2=='W' else 1])
        fixed[m] = ft
    # Assign each actual matchup to the match number whose fixed (W/R) teams it contains.
    # Resolve 2-fixed matches first (unambiguous), then 1-fixed, to avoid greedy collisions.
    assign = {}
    pending = list(r32_actual)
    for need in (2, 1):
        still = []
        for (h, a) in pending:
            pair = {h, a}
            found = None
            for m, ft in fixed.items():
                if m in assign or len(ft) != need:
                    continue
                if set(ft) <= pair:
                    found = m; break
            if found is None:
                still.append((h, a))
            else:
                assign[found] = (h, a)
        pending = still
    return st, assign

if __name__ == '__main__':
    df = pd.read_csv('/tmp/wc_results.csv')
    wc = df[(df.tournament=='FIFA World Cup') & (df.date.str.startswith('2026'))]
    grp = wc[(wc.home_score.notna()) & (wc.date<='2026-06-27')]
    r32 = wc[(wc.date>='2026-06-28')][['home_team','away_team']].values.tolist()
    # include the played M73 (Canada vs South Africa, 06-28)
    r32_actual = [tuple(x) for x in r32]
    st, assign = build_bracket(grp, r32_actual)
    print("Group winners / runners-up / thirds:")
    for L in 'ABCDEFGHIJKL':
        print(f"  {L}: 1st={st[L][0]:24s} 2nd={st[L][1]:22s} 3rd={st[L][2]}")
    print(f"\nR32 match assignment ({len(assign)} matches, expect 16, all numbers unique={len(set(assign))==16}):")
    for m in sorted(assign):
        print(f"  M{m}: {assign[m][0]} vs {assign[m][1]}")
    missing = set(range(73,89)) - set(assign)
    if missing: print("MISSING match numbers:", missing)
