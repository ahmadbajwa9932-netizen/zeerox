import './globals.css';
import ClientShell from './ClientShell';

export const metadata = {
    title: 'POS System',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            </head>
            <body>
                <ClientShell>{children}</ClientShell>
            </body>
        </html>
    );
}