import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

/**
 * Renders instructor-authored Markdown. react-markdown never uses innerHTML and we
 * don't enable raw HTML, so content can't inject scripts.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose prose-lms max-w-none prose-headings:tracking-tight prose-a:font-medium prose-table:text-sm', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a href={href} {...props} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
