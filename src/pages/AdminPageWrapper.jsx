import AdminPage from "./AdminPage.jsx";

const AdminPageWrapper = ({
  streams,
  onCreateStream,
  onUpdateStream,
  onDeleteStream,
  isAuthenticated,
  onLogin,
  onLogout,
  activeAdmin,
  logs,
}) => (
  <AdminPage
    streams={streams}
    onCreateStream={onCreateStream}
    onUpdateStream={onUpdateStream}
    onDeleteStream={onDeleteStream}
    isAuthenticated={isAuthenticated}
    onLogin={onLogin}
    onLogout={onLogout}
    activeAdmin={activeAdmin}
    logs={logs}
  />
);

export default AdminPageWrapper;
