"""Bounded source-driven metric-state correction, after a genuine PG E2E RED.

Only four CHECK expressions and four descriptions change. There is no new
column, table, key, payload store, or universal state registry.
"""
from copy import deepcopy

TABLES = ('football.player_match_metric_values', 'football.team_match_metric_values')
ONE_VALUE = "(value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0) OR (value_kind IN ('number','string','boolean') AND num_nonnulls(numeric_value,text_value,boolean_value)=1)"
VALUE_KIND = "(value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL) OR (value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0)"
OLD_ONE = 'num_nonnulls(numeric_value,text_value,boolean_value)=1'
OLD_KIND = "(value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL)"
OLD_DESCRIPTION = 'number, string ou boolean ; NULL/absence distingués par les états de champ.'
DESCRIPTION = 'number, string, boolean, null ou absent. null/absent n’ont ni scalaire primaire, ni fraction, ni affichage source. Une ligne absente signifie une observation inconnue ; absent exige un champ attendu et une couverture acceptée prouvés.'
OLD_ROLE = 'Métriques secondaires enregistrées, avec types, unité et fractions explicites.'
ROLE = 'Observations typées de métriques enregistrées et de leur état natif, avec unité et fractions explicites ; une projection numérique commune ne remplace pas cet état.'


def apply(model, changes):
    candidate = deepcopy(model)
    tables = {t['qualified_name']: t for s in candidate['schemas'] for t in s['tables']}
    amendments = []
    for name in TABLES:
        table = tables[name]
        for suffix, before, after in (('_one_value_ck', OLD_ONE, ONE_VALUE), ('_value_kind_ck', OLD_KIND, VALUE_KIND)):
            check = next(c for c in table['checks'] if c['name'] == name.replace('.', '_') + suffix)
            if check['sql'] not in (before, after):
                raise ValueError('Unexpected native metric CHECK before bounded correction')
            if check['sql'] != after:
                amendments.append(dict(table=name, operation='change_check', column=None, name=check['name'], before=before, after=after,
                                       reason='Retain explicit null/absent native metric states without contradictory scalars.'))
                check['sql'] = after
        value = table['columns']['value_kind']
        if value['description'] not in (OLD_DESCRIPTION, DESCRIPTION):
            raise ValueError('Unexpected native metric state description')
        if value['description'] != DESCRIPTION:
            amendments.append(dict(table=name, operation='change_description', column='value_kind', before=value['description'], after=DESCRIPTION,
                                   reason='Remove the reference to the deleted universal field-state store.'))
            value['description'] = DESCRIPTION
        if OLD_ROLE in table['description']:
            before = table['description']
            table['description'] = before.replace(OLD_ROLE, ROLE, 1)
            amendments.append(dict(table=name, operation='change_description', column=None, before=before, after=table['description'],
                                   reason='Clarify retained registered metric observations and native-state authority.'))
        elif ROLE not in table['description']:
            raise ValueError('Unexpected metric observation responsibility')
    model.clear()
    model.update(candidate)
    changes.extend(amendments)
    return model
