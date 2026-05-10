import './globals.css';
import { AppProvider } from '@/lib/context';
import { Toaster } from 'react-hot-toast';

export const metadata = {
  title: 'AI Chat',
  description: 'ChatGPT-like AI assistant',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#1f1f1f',
                color: '#e8e8e8',
                border: '1px solid #2a2a2a',
              },
            }}
          />
        </AppProvider>
      </body>
    </html>
  );
}
