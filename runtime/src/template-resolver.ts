/**
 * Template Resolver — replaces {{VARIABLE}} placeholders with runtime values.
 * Unknown variables are left as-is (not removed, not errored).
 * Supports hyphenated variable names (e.g., {{profile-name}}).
 * See spec Section 6.13 for the full variable reference.
 */

export function resolveTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  if (!template) return template;

  return template.replace(/\{\{([\w-]+)\}\}/g, (match, key: string) => {
    return key in variables ? variables[key] : match;
  });
}
