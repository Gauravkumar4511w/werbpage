// Opens a top-up or withdrawal screenshot in the Admin Desk viewer; a dash when none was uploaded.
function ScreenshotButton({ show, onView }) {
  return show ? <button type="button" className="admin-copy" onClick={onView}>View</button> : <small>-</small>
}

export default ScreenshotButton
