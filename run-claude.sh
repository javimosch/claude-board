#!/bin/bash
# Wrapper script to run Claude without CLAUDECODE

unset CLAUDECODE
exec claude "$@"
