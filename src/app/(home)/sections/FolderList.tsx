import { Body, Heading } from '@assembly-js/design-system';
import type { FolderItem } from '@/utils/files';

function FolderIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-gray-400"
      aria-hidden="true"
    >
      <path
        d="M3 6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FolderList({
  companyName,
  folders,
}: {
  companyName?: string;
  folders: FolderItem[];
}) {
  return (
    <section>
      <div className="mb-6">
        <Heading size="xl">Files</Heading>
        {companyName && (
          <Body size="base" className="text-gray-500 mt-1">
            {companyName}
          </Body>
        )}
      </div>

      {folders.length === 0 ? (
        <Body size="base" className="text-gray-500">
          No folders yet.
        </Body>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
          {folders.map((folder) => (
            <li key={folder.id} className="flex items-center gap-3 px-4 py-3">
              <FolderIcon />
              <Body size="base" className="font-medium">
                {folder.name}
              </Body>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
