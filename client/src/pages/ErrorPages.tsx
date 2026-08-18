import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.js';

function Centered({ code, title, message }: { code: string; title: string; message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
      <p className="font-heading text-6xl font-bold text-accent">{code}</p>
      <h1 className="mt-4 font-heading text-2xl text-text-primary">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-text-muted">{message}</p>
      <Link to="/" className="mt-6">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  return <Centered code="404" title="Page not found" message="This page doesn't exist or has moved." />;
}

export function UnauthorizedPage() {
  return (
    <Centered
      code="403"
      title="Access denied"
      message="You don't have permission to view this page. Contact your administrator if you believe this is a mistake."
    />
  );
}
