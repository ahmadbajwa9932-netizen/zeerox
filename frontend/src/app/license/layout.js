import '../auth/auth.css';

export default function LicenseLayout({ children }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title></title>
            </head>
            <body>
                {children}
            </body>
        </html>
    );
}