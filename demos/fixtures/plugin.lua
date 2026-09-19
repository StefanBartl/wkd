local M = {}

function M.current_line()
  local row = vim.api.nvim_win_get_cursor(0)[1]
  return vim.api.nvim_buf_get_lines(0, row - 1, row, false)[1]
end

function M.replace_line(text)
  local row = vim.api.nvim_win_get_cursor(0)[1]
  vim.api.nvim_buf_set_lines(0, row - 1, row, false, { text })
end

function M.append(text)
  local last = vim.api.nvim_buf_line_count(0)
  vim.api.nvim_buf_set_lines(0, last, last, false, { text })
  vim.api.nvim_win_set_cursor(0, { last + 1, 0 })
end

function M.word()
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  local line = vim.api.nvim_buf_get_lines(0, row - 1, row, false)[1]
  return line:sub(col + 1):match("^%w+")
end

return M
