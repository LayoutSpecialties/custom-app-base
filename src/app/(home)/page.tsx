import { Container } from '@/components/Container';
import { getSession } from '@/utils/session';
import { getFolderView } from '@/utils/files';
import { GettingStarted } from './sections/GettingStarted';
import { MissingApiKey } from './sections/MissingApiKey';
import { BridgeConfigProvider } from './sections/BridgeConfigProvider';
import { FolderList } from './sections/FolderList';
import { ManageStatuses } from './sections/ManageStatuses';
import { AutoRefresh } from './sections/AutoRefresh';
import { CompanyPicker } from './sections/CompanyPicker';

export const dynamic = 'force-dynamic';

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const token =
    'token' in searchParams && typeof searchParams.token === 'string'
      ? searchParams.token
      : undefined;
  const selectedCompanyId =
    'companyId' in searchParams && typeof searchParams.companyId === 'string'
      ? searchParams.companyId
      : undefined;
  const currentPath =
    'path' in searchParams && typeof searchParams.path === 'string'
      ? searchParams.path
      : '';
  const session = await getSession(searchParams);
  const view = await getFolderView(token, selectedCompanyId, currentPath);

  return (
    <>
      <BridgeConfigProvider portalUrl={session.workspace?.portalUrl} />
      <AutoRefresh />
      <Container className="max-w-screen-lg">
        {view.isInternal && (
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 min-w-0">
              {view.companies && view.companies.length > 0 && (
                <CompanyPicker
                  companies={view.companies}
                  companyId={view.companyId}
                />
              )}
            </div>
            <ManageStatuses statuses={view.statuses} token={token} />
          </div>
        )}
        <FolderList
          breadcrumb={view.breadcrumb}
          items={view.items}
          statuses={view.statuses}
          isInternal={view.isInternal}
          channelId={view.channelId}
          token={token}
        />
      </Container>
    </>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const hasToken = 'token' in params && typeof params.token === 'string';

  // Check for API key before proceeding
  if (!process.env.ASSEMBLY_API_KEY) {
    return <MissingApiKey />;
  }

  if (!hasToken) {
    return <GettingStarted />;
  }

  return <Content searchParams={params} />;
}
