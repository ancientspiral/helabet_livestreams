import { Link, useLocation } from "react-router-dom";
import { FiChevronDown, FiSearch } from "react-icons/fi";

const NAV_ITEMS = [{ label: "HOME", dropdown: false, path: "/" }];

const noop = () => {};

const Header = ({ searchQuery = "", onSearchChange = noop }) => {
  const location = useLocation();

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    onSearchChange(searchQuery, true);
  };

  const handleInputChange = (event) => {
    onSearchChange(event.target.value, false);
  };

  return (
    <header className="topbar">
      <div className="container header-inner">
        <nav className="primary-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.path}
              className={`nav-link${
                location.pathname === item.path ? " is-active" : ""
              }`}
            >
              <span>{item.label}</span>
              {item.dropdown && <FiChevronDown aria-hidden="true" />}
            </Link>
          ))}
        </nav>

        <form
          className="header-search"
          role="search"
          onSubmit={handleSearchSubmit}
        >
          <input
            id="site-search"
            type="search"
            placeholder="Search matches"
            aria-label="Search live streams"
            value={searchQuery}
            onChange={handleInputChange}
          />
          <button
            type="submit"
            className="search-submit"
            aria-label="Submit search"
          >
            <FiSearch aria-hidden="true" />
          </button>
        </form>

        <div className="header-right">
          <button type="button" className="btn btn-yellow">
            Registration
          </button>
          <button type="button" className="btn btn-secondary">
            Log in
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
