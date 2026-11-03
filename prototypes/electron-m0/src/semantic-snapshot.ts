type AXValue = { value?: unknown };
export type AXNode = { nodeId: string; parentId?: string; ignored?: boolean; role?: AXValue; name?: AXValue; properties?: { name: string; value: AXValue }[] };

// Accessible names only: never serialize AX values, HTML, form values or cookies.
export function semanticSnapshot(nodes: AXNode[]): { text: string; truncated: boolean } {
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const editableRoles = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
  function blocked(node: AXNode): boolean {
    const seen = new Set<string>();
    let current: AXNode | undefined = node;
    while (current) {
      if (seen.has(current.nodeId)) return true;
      seen.add(current.nodeId);
      if (editableRoles.has(String(current.role?.value).toLowerCase()) || current.properties?.some(p => p.name === 'editable' && p.value.value && p.value.value !== 'false')) return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  }
  const lines: string[] = [];
  let length = 0;
  let truncated = false;
  for (const node of nodes) {
    if (node.ignored || blocked(node) || typeof node.name?.value !== 'string' || !node.name.value.trim()) continue;
    const line = `[${String(node.role?.value || 'text')}] ${node.name.value.trim()}`;
    if (lines.length >= 1000 || length + line.length + 1 > 16000) { truncated = true; break; }
    lines.push(line); length += line.length + 1;
  }
  return { text: lines.join('\n'), truncated };
}
