"""The canonical encoding of a row, as the loader computes it from Arrow and the server from the stored row
(backend/panna/FAILURE_MODES.md, Rules: Segments). Per value: `N` for NULL; `T<octets>:<text>`; `I<integer>`;
`D<the IEEE-754 bits as a signed 64-bit integer>`, any NaN as the canonical quiet NaN (PostgreSQL's own). The values
of a row in the source's column order, each followed by `|`, then a newline. A segment's digest is the SHA-256 of its
rows' encodings in source order. Injective: the octet count delimits text, the bits are the double itself."""

import hashlib

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

QUIET_NAN = np.int64(0x7FF8000000000000)
_STR = pa.large_string()
EXACT = float(2 ** 53)


def inexact(array):
    """How many non-null values of a double array are not exact integers within ±2^53: NaN, ±inf, a fraction, beyond
    2^53, or -0.0 (whose sign an integer cannot keep). A NULL is allowed: it stays NULL."""
    values = array.cast(pa.float64())
    valid = ~values.is_null().to_numpy(zero_copy_only=False)
    v = values.fill_null(0.0).to_numpy(zero_copy_only=False)
    with np.errstate(invalid="ignore"):
        bad = valid & (~np.isfinite(v) | (np.trunc(v) != v) | (np.abs(v) > EXACT) | ((v == 0) & np.signbit(v)))
    return int(bad.sum())


def exact_int64(array):
    """The int64 array holding exactly the values of a double array that `inexact` accepts (NULL kept)."""
    if inexact(array):
        raise ValueError("not exact integers")
    values = array.cast(pa.float64())
    valid = ~values.is_null().to_numpy(zero_copy_only=False)
    ints = values.fill_null(0.0).to_numpy(zero_copy_only=False).astype(np.int64)
    return pa.array(ints, pa.int64(), mask=~valid)


def convert(batch, conversions):
    """`batch` with each column named in `conversions` read as its dataset's type (the one rule: exact_integer)."""
    if not conversions:
        return batch
    arrays, fields = [], []
    for field, column in zip(batch.schema, batch.columns):
        if field.name in conversions:
            column = exact_int64(column)
            field = pa.field(field.name, pa.int64())
        arrays.append(column)
        fields.append(field)
    return pa.RecordBatch.from_arrays(arrays, schema=pa.schema(fields))


def _s(text):
    return pa.scalar(text, _STR)


def encode_column(array, pg_type):
    if pg_type == "text":
        text = array.cast(_STR)
        out = pc.binary_join_element_wise(_s("T"), pc.cast(pc.binary_length(text), _STR), _s(":"), text, _s(""))
    elif pg_type == "bigint":
        out = pc.binary_join_element_wise(_s("I"), pc.cast(array.cast(pa.int64()), _STR), _s(""))
    elif pg_type == "double precision":
        values = array.cast(pa.float64()).fill_null(0.0).to_numpy(zero_copy_only=False).astype(np.float64, copy=True)
        bits = values.view(np.int64).copy()
        bits[np.isnan(values)] = QUIET_NAN
        out = pc.binary_join_element_wise(_s("D"), pc.cast(pa.array(bits, pa.int64()), _STR), _s(""))
    else:
        raise ValueError(f"no canonical encoding for {pg_type}")
    return pc.if_else(pc.is_null(array), _s("N"), out)


def encode_rows(batch, columns):
    """The encodings of the rows of `batch` (a RecordBatch or Table), one large_string per row."""
    parts = [encode_column(batch.column(c.name), c.pg_type) for c in columns]
    joined = pc.binary_join_element_wise(*parts, _s("|"))
    out = pc.binary_join_element_wise(joined, _s("|\n"), _s(""))
    if isinstance(out, pa.ChunkedArray):
        out = out.combine_chunks()
    return out


class Spans:
    """Byte spans of an encoded array: `span(a, b)` is the bytes of rows a to b (exclusive), zero-copy."""

    def __init__(self, encoded):
        self.encoded = encoded
        buffers = encoded.buffers()
        self.offsets = np.frombuffer(buffers[1], dtype=np.int64)[encoded.offset: encoded.offset + len(encoded) + 1]
        self.data = memoryview(buffers[2]) if buffers[2] is not None else memoryview(b"")

    def span(self, a, b):
        return self.data[int(self.offsets[a]): int(self.offsets[b])]


def digest(encoded):
    return hashlib.sha256(Spans(encoded).span(0, len(encoded))).digest()


def sql_value(name, pg_type, alias="d"):
    c = f'{alias}."{name}"'
    if pg_type == "text":
        return f"coalesce('T' || octet_length({c})::text || ':' || {c}, 'N')"
    if pg_type == "bigint":
        return f"coalesce('I' || {c}::text, 'N')"
    if pg_type == "double precision":
        return f"coalesce('D' || (('x' || encode(float8send({c}), 'hex'))::bit(64)::bigint)::text, 'N')"
    raise ValueError(pg_type)


def sql_row(columns, alias="d"):
    """The server's encoding of a stored row (columns in the source's order)."""
    return " || ".join(f"{sql_value(c.name, c.pg_type, alias)} || '|'" for c in columns) + " || E'\\n'"


def sql_digests(table, columns):
    """A statement giving (segment_id, digest) for the segments whose ids are passed as %s (an int array)."""
    return (f"SELECT d.segment_id, sha256(convert_to(string_agg({sql_row(columns)}, '' ORDER BY d.ordinal), 'UTF8')) "
            f"FROM panna_data.{table} d WHERE d.segment_id = ANY(%s) GROUP BY d.segment_id")
