import PlayerFrame from "./PlayerFrame";

export interface LiveHlsPlayerProps {
  videoId?: string | null;
  sgi?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const LiveHlsPlayer = ({ videoId, sgi, isOpen, onClose }: LiveHlsPlayerProps) => {
  if (!isOpen || (!videoId && !sgi)) {
    return null;
  }

  return (
    <div className="live-player-overlay" role="dialog" aria-modal="true">
      <div className="live-player-container">
        <button
          type="button"
          className="live-player-close btn btn-outline btn-compact"
          onClick={onClose}
        >
          Close
        </button>
        <PlayerFrame videoId={videoId ?? undefined} sgi={sgi ?? undefined} />
      </div>
    </div>
  );
};

export default LiveHlsPlayer;
