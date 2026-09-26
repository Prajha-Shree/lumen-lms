import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Button, EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page you’re looking for doesn’t exist or you don’t have access to it."
      action={
        <Link to="/">
          <Button>Back to dashboard</Button>
        </Link>
      }
      className="mx-auto mt-16 max-w-lg"
    />
  );
}
