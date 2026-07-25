/**
 * UI-only URN → friendly label helpers. Never mutates backend data.
 */

const DATASET_URN_RE =
  /^urn:li:dataset:\(urn:li:dataPlatform:[^,]+,([^,]+),(?:PROD|DEV|TEST)\)$/;
const CORP_GROUP_RE = /^urn:li:corpGroup:(.+)$/;
const GLOSSARY_RE = /^urn:li:glossaryTerm:(.+)$/;
const TAG_RE = /^urn:li:tag:(.+)$/;

function lastSegment(value: string): string {
  const parts = value.split(/[./]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function humanizeIdentifier(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function urnDisplayLabel(urn: string): string {
  const trimmed = urn.trim();
  if (!trimmed) return '';

  const dataset = DATASET_URN_RE.exec(trimmed);
  if (dataset) {
    return lastSegment(dataset[1]);
  }

  const group = CORP_GROUP_RE.exec(trimmed);
  if (group) {
    return humanizeIdentifier(group[1]);
  }

  const glossary = GLOSSARY_RE.exec(trimmed);
  if (glossary) {
    return humanizeIdentifier(glossary[1]);
  }

  const tag = TAG_RE.exec(trimmed);
  if (tag) {
    return humanizeIdentifier(tag[1]);
  }

  if (trimmed.startsWith('urn:li:')) {
    return humanizeIdentifier(lastSegment(trimmed));
  }

  return trimmed;
}

export function urnShortDatasetName(urn: string): string {
  const dataset = DATASET_URN_RE.exec(urn.trim());
  if (!dataset) return urnDisplayLabel(urn);
  return lastSegment(dataset[1]);
}
