/** D7811: one shared table of literal spreadsheet serialization expectations.
 *
 * From frontend/test/README.md (moved by #6472): D7811: one literal CSV case table shared with
 * Worker tests.
 */
export const CSV_SAFE_CASES = [
  ['formula', '=SUM(A1:A2)', "'=SUM(A1:A2)"],
  ['plus command', '+cmd', "'+cmd"], ['at command', '@IMPORT', "'@IMPORT"],
  ['tab', '\t=1', "'\t=1"], ['carriage return', '\r=1', '"\'\r=1"'],
  ['number', 42, '42'], ['negative number', -42, '-42'], ['decimal text', '-1.5', '-1.5'],
  ['signed positive text', '+42', "'+42"], ['positive percent', '+12%', "'+12%"], ['negative percent', '-12%', "'-12%"],
  ['currency negative', '-$12', "'-$12"], ['grouped negative', '-1,234', '"\'-1,234"'],
  ['hyphen', '-', "'-"], ['phone', '+442012345678', "'+442012345678"],
  ['date', '2026-11-22', '2026-11-22'], ['quotes', 'a"b', '"a""b"'],
  ['line break', 'a\nb', '"a\nb"'], ['empty', '', ''], ['null', null, ''], ['undefined', undefined, ''],
  ['already prefixed', "'=1", "'=1"], ['object', { a: 1 }, '[object Object]'],
];
