; Version comparison using PowerShell
; Returns -1 if VER1 < VER2, 0 if equal, 1 if VER1 > VER2
; Usage: ${VersionCompare} "1.0.0" "1.2.0" $R0

!macro VersionCompare VER1 VER2 RESULT
  nsExec::ExecToStack 'powershell -NoProfile -Command "[version]\"${VER1}\".CompareTo([version]\"${VER2}\")"'
  Pop ${RESULT}
!macroend
