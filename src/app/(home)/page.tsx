import { Container } from '@/components/Container';
import { getSession } from '@/utils/session';
import { getFolderView } from '@/utils/files';
import { GettingStarted } from './sections/GettingStarted';
import { MissingApiKey } from './sections/MissingApiKey';
import { BridgeConfigProvider } from './sections/BridgeConfigProvider';
import { FolderList } from './sections/FolderList';

export const dynamic = 'force-dynamic';

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const token =
    'token' in searchParams && typeof searchParams.token === 'string'
      ? searchParams.token
      : undefined;
  const session = await getSession(searchParams);
  const view = await getFolderView(token);

  return (
    <>
      <BridgeConfigProvider portalUrl={session.workspace?.portalUrl} />
      <Container className="max-w-screen-lg">
        <FolderList companyName={view.companyName} folders={view.folders} />
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
