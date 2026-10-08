// Return every cleanup error, rather than interpreting Docker API failures as
// resource absence. The caller supplies a synchronous Docker command runner.
export function cleanupDockerResources(resources, run) {
  const errors = [];
  for (const [type, name] of resources) {
    const query = type === 'image'
      ? ['image', 'ls', '--quiet', '--filter', `reference=${name}`]
      : [type, 'ls', ...(type === 'container' ? ['--all'] : []), '--quiet', '--filter',
        `name=${type === 'container' ? `^/${name}$` : name}`];
    const listed = run(query);
    if (listed.error || listed.status !== 0) {
      errors.push(`Unable to list ${type} ${name}`);
      continue;
    }
    if (!listed.stdout?.trim()) continue;
    const removed = run([type, 'rm', ...(type === 'container' ? ['--force'] : []), name]);
    if (removed.error || removed.status !== 0) errors.push(`Unable to remove ${type} ${name}`);
  }
  return errors;
}
