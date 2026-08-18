import { Construction } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/EmptyState.js';

/** Stand-in for module pages not yet implemented. */
export function PlaceholderPage({ title, module }: { title: string; module?: string }) {
  return (
    <div>
      <PageHeader title={title} description={module ? `${module}` : undefined} />
      <EmptyState
        icon={<Construction className="h-8 w-8" />}
        title="Coming together"
        description="This module's screens land in an upcoming build slice. The route, navigation, and access control are already wired."
      />
    </div>
  );
}
