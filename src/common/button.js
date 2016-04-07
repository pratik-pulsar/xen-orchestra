import React from 'react'
import classNames from 'classnames'

const Button = ({children, action, type = 'secondary', dropdown = false}) => (
  <button
    type='button'
    className={classNames(
      'btn',
      `btn-${type}`,
      dropdown && 'dropdown-toggle'
    )}
    data-toggle={dropdown ? 'dropdown' : undefined}
    aria-haspopup={dropdown ? 'true' : undefined}
    aria-expanded={dropdown ? 'false' : undefined}
    onClick={action}
  >
    {children}
  </button>
)
Button.propTypes = {
  action: React.PropTypes.func,
  type: React.PropTypes.string
}
export default Button

export const ButtonGroup = ({children}) => (
  <div className='btn-group'>
    {children}
  </div>
)

export const DropdownMenu = ({children}) => (
  <div className='dropdown-menu'>
    {children}
  </div>
)

export const DropdownMenuItem = ({children, action}) => (
  <a className='dropdown-item' onClick={action} style={{cursor: 'pointer'}}>
    {children}
  </a>
)
