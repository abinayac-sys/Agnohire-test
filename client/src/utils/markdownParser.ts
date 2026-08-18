export function extractProperties(markdown: string): Record<string, string> {
  const props: Record<string, string> = {};
  // Match lines like: **Name:** John Doe or - **Status:** Active
  const regex = /(?:-?\s*\*\*(.+?)\*\*:\s*(.+))|(?:-?\s*(.+?):\s*(.+))/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    if (match[1] && match[2]) {
      props[match[1].trim()] = match[2].trim();
    } else if (match[3] && match[4]) {
      // Avoid matching http:// or https:// as key value
      if (!match[3].includes('http') && match[3].length < 30) {
        props[match[3].trim()] = match[4].trim();
      }
    }
  }
  return props;
}

export function extractSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = markdown.split('\n');
  let currentSection = 'General';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  return sections;
}

export function extractStatus(markdown: string): string | null {
  const props = extractProperties(markdown);
  const statusKey = Object.keys(props).find(k => k.toLowerCase() === 'status');
  return statusKey ? props[statusKey] : null;
}
