import ConversationView from './ConversationView';

export default async function ConversationPage({ params }) {
  const { id } = await params;
  return <ConversationView conversationId={id} />;
}
