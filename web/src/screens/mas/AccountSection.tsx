import { ChangePassword } from '../../auth/ChangePassword';
import { LogoutButton } from '../../auth/LogoutButton';
import { Card } from '../../components';
import { masStrings } from './strings';

// Cuenta: los dos formularios de sesión de UI-08, sin duplicar su lógica.
export function AccountSection() {
  return (
    <section className="stack" aria-labelledby="mas-account-title">
      <div className="section-title">
        <h2 id="mas-account-title">{masStrings.account.title}</h2>
      </div>
      <Card>
        <ChangePassword />
      </Card>
      <LogoutButton />
    </section>
  );
}

export default AccountSection;
