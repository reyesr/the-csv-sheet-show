# Synthetic CSV Generator

Generate a CSV file and a JSON metadata file with the same basename. The metadata follows the shape used by `test-data/annual-enterprise-survey-2024-financial-year-provisional.json` and adds a `mapping` array containing byte offsets for the start of every CSV row.

## Usage

```bash
bun test-data/generator/generate.js \
  --output test-data/synthetic-commerce-orders \
  --header "order_id,customer_id,first_name,last_name,item,quantity,total" \
  --types "id,uuid,first-name,last-name,text,integer,decimal" \
  --row-count 10000 \
  --encoding utf-8 \
  --line-ending lf \
  --separator "," \
  --decimal-separator . \
  --seed 123456789
```

This creates:

- `test-data/synthetic-commerce-orders.csv`
- `test-data/synthetic-commerce-orders.json`

The JSON `row-count` is the number of rows in the CSV file. If a header is present, it includes the header row. It is always equal to `mapping.length`.

## Arguments

- `--output <basename>`: Output path without extension. Default: `synthetic-data`.
- `--header <header-description>`: Optional header column names separated with commas, for example `"id,first name,last name"`. If omitted, the CSV has no header and metadata `has-header` is `false`.
- `--types <type-list>`: Synthetic type names separated with commas. Quote a type to quote generated values for that column, for example `id,"first-name",last-name,text`.
- `--row-count <number>`: Number of data rows to generate, excluding the header row. Default: `1000`.
- `--encoding <encoding>`: Output encoding supported by `iconv-lite`, for example `utf-8`, `latin1`, or `windows-1252`. Default: `utf-8`.
- `--line-ending <cr|lf|crlf>`: Row line ending. Default: `lf`.
- `--separator <string>`: Cell separator. Default: `,`.
- `--separator: <string>`: Also accepted for compatibility with prompts that include the colon in the option name.
- `--decimal-separator <.|,>`: Decimal separator for generated decimal values. Default: `.`.
- `--seed <number>`: Optional deterministic seed. Default: `123456789`.

## Metadata Mapping

The generated JSON contains:

- `mapping`: An array of byte offsets in the CSV file.
- `mapping[0]`: Always `0`, the beginning of the first physical CSV row. This is the header row when `--header` is specified, otherwise the first data row.
- `mapping[n]`: The byte offset where row `n` starts.
- `row-count`: Equal to `mapping.length` and to the number of rows physically present in the CSV file.

## Supported Types

- `id`: Incremental counter starting at `1`.
- `uuid`: UUID v4.
- `first-name`: Typical first name.
- `last-name`: Typical last name.
- `text`: Random text between 6 and 12 characters.
- `integer`: Random integer between `0` and `10000`.
- `decimal`: Random decimal number between `0` and `100`.

## Example Large Datasets

Commerce, more than 10,000 rows, comma separator, LF endings:

```bash
bun test-data/generator/generate.js --output test-data/synthetic-commerce-orders --header "order_id,customer_uuid,first_name,last_name,product,quantity,total" --types "id,uuid,first-name,last-name,text,integer,decimal" --row-count 10001 --encoding utf-8 --line-ending lf --separator "," --decimal-separator . --seed 1001
```

Health care clinic, 100,000 rows, semicolon separator, CRLF endings, comma decimals:

```bash
bun test-data/generator/generate.js --output test-data/synthetic-health-care-clinic-visits --header "visit_id,patient_uuid,first_name,last_name,diagnosis_code,age,billed_amount" --types "id,uuid,first-name,last-name,text,integer,decimal" --row-count 100000 --encoding utf-8 --line-ending crlf --separator ";" --decimal-separator , --seed 2001
```

Pet shop, 500,000 rows, pipe separator, CR endings:

```bash
bun test-data/generator/generate.js --output test-data/synthetic-pet-shop-sales --header "sale_id,customer_uuid,first_name,last_name,pet_name,item_count,total_amount" --types "id,uuid,first-name,last-name,text,integer,decimal" --row-count 500000 --encoding utf-8 --line-ending cr --separator "|" --decimal-separator . --seed 3001
```

## Notes For LLM Usage

- If `--header` is used, keep `--header` and `--types` column counts identical. Omit `--header` to generate a headerless CSV.
- Use quoted types when a column should contain quoted CSV values, for example `id,"first-name","last-name",decimal`.
- Prefer explicit filenames that describe the domain and row count.
- Use different separators and line endings when generating test fixtures for parser coverage.
- Use explicit `--seed` values for committed fixtures so they can be regenerated reproducibly.
