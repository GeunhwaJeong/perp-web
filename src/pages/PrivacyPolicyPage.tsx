import styled from 'styled-components';

import { articleMixins } from '@/styles/articleMixins';

const PrivacyPolicyPage = () => (
  <$Article>
    <header>
      <h1>Privacy Policy</h1>
      <span>Last updated: November 10, 2026</span>
    </header>
    <div>
      <p>
        This policy describes the information involved when you use Sigma. Sigma is at an early
        stage, and this policy may change as Sigma changes.
      </p>
      <ul>
        <li>
          We do not ask for your legal name, email address, phone number, or identity documents.
        </li>
        <li>We do not set cookies, and we do not use analytics or advertising tools.</li>
        <li>
          Your recovery phrase and your password stay in your browser. They are not sent to us, and
          we cannot recover them for you.
        </li>
        <li>
          Our servers receive your IP address and the contents of the requests that your browser
          sends to them.
        </li>
        <li>
          Your transactions are recorded on the Haneul blockchain. Information on the blockchain,
          including your address, your name, your orders, your positions, and your trades, is
          public, and we cannot change or delete it.
        </li>
      </ul>
      <p>
        If you have questions about this policy, then contact us at{' '}
        <a href="mailto:geunhwa@haneul.io">geunhwa@haneul.io</a>.
      </p>
    </div>
  </$Article>
);

export default PrivacyPolicyPage;
const $Article = styled.article`
  ${articleMixins.article}
`;
